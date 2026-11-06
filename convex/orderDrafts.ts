import { assertBookableVisitSlot, orderRefFromId, saleRefFromId } from "@skyla/payments";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { requireStaffUser } from "./lib/auth";
import {
  assertCheckoutDraftCanStartPayment,
  checkoutDraftExpiresAt,
  checkoutDraftIsAbandoned,
  checkoutDraftTtlMs,
  posDraftTtlMs
} from "./lib/checkoutDraftExpiry";
import {
  assertSameDraftFingerprint,
  buildCheckoutDraftWrite,
  buildPosSaleDraftWrite,
  checkoutDraftResult,
  normalizeIdempotencyKey,
  posSaleDraftResult
} from "./lib/orderDraftPersistence";
import {
  findCapacityReservation,
  loadVenueHours,
  placeCapacityHold,
  releaseUnpaidCapacityHold,
  ticketPartySize
} from "./lib/capacity";
import { consumePublicGatewayRateLimit } from "./lib/publicGateway";
import { authorizeTerminalReaderSelection } from "./lib/terminalReaderRegistry";

declare const process: { env: Record<string, string | undefined> };

const ticketPackageKey = v.union(
  v.literal("general"),
  v.literal("drink"),
  v.literal("date-night"),
  v.literal("champagne-room"),
  v.literal("family-suite")
);

const addonQuantities = v.optional(
  v.object({
    matcha: v.optional(v.number()),
    pourover: v.optional(v.number()),
    hojicha: v.optional(v.number()),
    coldbrew: v.optional(v.number())
  })
);

const cafeItemKey = v.union(
  v.literal("m1"),
  v.literal("m2"),
  v.literal("m3"),
  v.literal("m4"),
  v.literal("c1"),
  v.literal("c2"),
  v.literal("c3"),
  v.literal("c4"),
  v.literal("c5"),
  v.literal("c6"),
  v.literal("c7"),
  v.literal("c8"),
  v.literal("c9"),
  v.literal("c10"),
  v.literal("b1"),
  v.literal("b2"),
  v.literal("b3"),
  v.literal("b4"),
  v.literal("b5"),
  v.literal("b6"),
  v.literal("b7"),
  v.literal("b8")
);

// Admission at the register: canonical age counts for one selected LA visit.
const posAdmission = v.object({
  packageKey: ticketPackageKey,
  adults: v.number(),
  children: v.optional(v.number()),
  freeChildren: v.optional(v.number()),
  visitDate: v.string(),
  entryTime: v.string()
});

const posSaleLine = v.union(
  v.object({
    kind: v.literal("cafe"),
    itemKey: cafeItemKey,
    quantity: v.optional(v.number())
  }),
  v.object({
    kind: v.literal("custom"),
    name: v.string(),
    amountCents: v.number(),
    quantity: v.optional(v.number()),
    reason: v.string()
  })
);

export const createCheckoutOrderDraft = internalMutation({
  args: {
    gatewayRateLimitKey: v.string(),
    packageKey: ticketPackageKey,
    adults: v.number(),
    children: v.optional(v.number()),
    freeChildren: v.optional(v.number()),
    addons: addonQuantities,
    visitDate: v.optional(v.string()),
    entryTime: v.optional(v.string()),
    customerEmail: v.optional(v.string()),
    source: v.optional(v.string()),
    idempotencyKey: v.string()
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await consumePublicGatewayRateLimit(ctx, "checkout-draft", args.gatewayRateLimitKey, now);
    const pendingWrite = buildCheckoutDraftWrite(args, { orderRef: "pending", now });
    const existingOrder = await ctx.db
      .query("orders")
      .withIndex("by_channel_idempotencyKey", (q) =>
        q.eq("channel", "online").eq("idempotencyKey", pendingWrite.input.idempotencyKey)
      )
      .first();

    if (existingOrder) {
      if (existingOrder.status === "expired" || checkoutDraftIsAbandoned(existingOrder, now)) {
        throw new Error("Checkout order draft has expired");
      }
      if (existingOrder.status !== "draft" && existingOrder.status !== "payment_pending") {
        throw new Error(`Checkout order cannot be reused from status ${existingOrder.status}`);
      }
      assertSameDraftFingerprint(existingOrder.draftFingerprint, pendingWrite.draftFingerprint);
      const existingLines = await ctx.db
        .query("orderLineItems")
        .withIndex("by_orderRef", (q) => q.eq("orderRef", existingOrder.orderRef))
        .collect();
      return checkoutResult(existingOrder, existingLines);
    }

    const hours = await loadVenueHours(ctx);
    const visit = assertBookableVisitSlot(hours, pendingWrite.input.visitDate, pendingWrite.input.entryTime, now);

    const expiresAt = now + checkoutDraftTtlMs;
    const orderId = await ctx.db.insert("orders", { ...pendingWrite.order, expiresAt });
    const orderRef = orderRefFromId(orderId, now);
    const write = buildCheckoutDraftWrite(args, { orderRef, now });

    await ctx.db.patch(orderId, { orderRef });
    for (const line of write.lines) {
      await ctx.db.insert("orderLineItems", line);
    }
    // Same transaction as the order: Convex serializes conflicting mutations,
    // so concurrent last-place requests cannot both pass this check.
    await placeCapacityHold(ctx, {
      orderRef,
      visitDate: visit.visitDate,
      entryTime: visit.entryTime,
      partySize: ticketPartySize(write.lines),
      status: "draft",
      hours,
      now
    });

    await ctx.scheduler.runAt(expiresAt, internal.orderDrafts.expireCheckoutOrderDraft, { orderRef });

    return checkoutResult({ ...write.order, expiresAt }, write.lines);
  }
});

export const expireCheckoutOrderDraft = internalMutation({
  args: { orderRef: v.string() },
  handler: async (ctx, args) => {
    const order = await ctx.db
      .query("orders")
      .withIndex("by_orderRef", (query) => query.eq("orderRef", args.orderRef))
      .unique();
    const now = Date.now();
    if (!order || order.channel !== "online" || !checkoutDraftIsAbandoned(order, now)) {
      return { expired: false };
    }

    await ctx.db.patch(order._id, {
      status: "expired",
      customerEmailLower: undefined,
      updatedAt: now
    });
    // Only a still-draft order reaches here, so no hosted payment can exist.
    await releaseUnpaidCapacityHold(ctx, order.orderRef, "draft_expired", now);
    return { expired: true };
  }
});

/**
 * Moves a draft order and its capacity hold to payment_pending before any
 * Stripe network call, so draft expiry can no longer release the places while
 * a hosted session may be payable. Retries are idempotent. An older order
 * without a hold reserves here (with the full purchase-time gate) or fails
 * before Stripe is contacted.
 */
export const beginCheckoutPaymentAttempt = internalMutation({
  args: {
    orderRef: v.string(),
    idempotencyKey: v.string()
  },
  handler: async (ctx, args) => {
    const order = await findCheckoutOrderForPayment(ctx, args);
    return moveCheckoutOrderToPaymentPending(ctx, order, Date.now());
  }
});

export async function findCheckoutOrderForPayment(
  ctx: MutationCtx,
  args: { orderRef: string; idempotencyKey: string }
) {
  const idempotencyKey = normalizeIdempotencyKey(args.idempotencyKey);
  const order = await ctx.db
    .query("orders")
    .withIndex("by_orderRef", (query) => query.eq("orderRef", args.orderRef))
    .unique();
  if (!order || order.channel !== "online" || order.idempotencyKey !== idempotencyKey) {
    throw new Error("Checkout order was not found for this payment attempt");
  }
  return order;
}

/** Shared by the attempt recorder so the hold moves in the same transaction. */
export async function moveCheckoutOrderToPaymentPending(ctx: MutationCtx, order: Doc<"orders">, now: number) {
  assertCheckoutDraftCanStartPayment(order, now);

  const reservation = await findCapacityReservation(ctx, order.orderRef);
  if (reservation?.status === "payment_pending" && order.status === "payment_pending") {
    return { status: "payment_pending" as const, reused: true };
  }
  if (reservation && reservation.status !== "draft") {
    throw new Error(`Visit unavailable: the capacity hold for this order is ${reservation.status}`);
  }

  if (order.status === "draft" || !reservation) {
    const hours = await loadVenueHours(ctx);
    assertBookableVisitSlot(hours, order.visitDate, order.entryTime, now);
    if (!reservation) {
      const lines = await ctx.db
        .query("orderLineItems")
        .withIndex("by_orderRef", (query) => query.eq("orderRef", order.orderRef))
        .collect();
      await placeCapacityHold(ctx, {
        orderRef: order.orderRef,
        visitDate: order.visitDate!,
        entryTime: order.entryTime!,
        partySize: ticketPartySize(lines),
        status: "payment_pending",
        hours,
        now
      });
    }
  }
  if (reservation) {
    await ctx.db.patch(reservation._id, { status: "payment_pending", paymentPendingAt: now, updatedAt: now });
  }
  await ctx.db.patch(order._id, { status: "payment_pending", expectedProvider: "stripe", updatedAt: now });
  return { status: "payment_pending" as const, reused: false };
}

/**
 * Releases a reviewed draft the guest replaced with a different order. Only a
 * still-draft order whose idempotency key matches is released; an order that
 * reached payment_pending may have a payable Session and is never touched.
 */
export const releaseCheckoutOrderDraft = internalMutation({
  args: {
    gatewayRateLimitKey: v.string(),
    orderRef: v.string(),
    idempotencyKey: v.string()
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await consumePublicGatewayRateLimit(ctx, "checkout-draft-release", args.gatewayRateLimitKey, now);
    const idempotencyKey = normalizeIdempotencyKey(args.idempotencyKey);
    const order = await ctx.db
      .query("orders")
      .withIndex("by_orderRef", (query) => query.eq("orderRef", args.orderRef))
      .unique();
    if (!order || order.channel !== "online" || order.idempotencyKey !== idempotencyKey) {
      // Same answer for unknown and mismatched orders; nothing is revealed.
      return { released: false as const };
    }
    if (order.status !== "draft") {
      return { released: false as const, status: order.status };
    }
    const attempt = await ctx.db
      .query("checkoutPaymentAttempts")
      .withIndex("by_orderRef", (query) => query.eq("orderRef", order.orderRef))
      .first();
    if (attempt) {
      return { released: false as const, status: order.status };
    }
    await ctx.db.patch(order._id, { status: "expired", customerEmailLower: undefined, updatedAt: now });
    await releaseUnpaidCapacityHold(ctx, order.orderRef, "draft_superseded", now);
    return { released: true as const };
  }
});

export const assertCheckoutOrderDraftActive = internalQuery({
  args: {
    orderRef: v.string(),
    idempotencyKey: v.string()
  },
  handler: async (ctx, args) => {
    const idempotencyKey = normalizeIdempotencyKey(args.idempotencyKey);
    const order = await ctx.db
      .query("orders")
      .withIndex("by_orderRef", (query) => query.eq("orderRef", args.orderRef))
      .unique();
    if (!order || order.channel !== "online" || order.idempotencyKey !== idempotencyKey) {
      throw new Error("Checkout order was not found for this payment attempt");
    }
    assertCheckoutDraftCanStartPayment(order, Date.now());
    return { expiresAt: checkoutDraftExpiresAt(order), status: order.status };
  }
});

export const getCheckoutOrderDraft = query({
  args: {
    orderRef: v.string(),
    idempotencyKey: v.string()
  },
  handler: async (ctx, args) => {
    const idempotencyKey = normalizeIdempotencyKey(args.idempotencyKey);
    const order = await ctx.db
      .query("orders")
      .withIndex("by_orderRef", (q) => q.eq("orderRef", args.orderRef))
      .unique();
    if (
      !order ||
      order.idempotencyKey !== idempotencyKey ||
      (order.status !== "draft" && order.status !== "payment_pending") ||
      checkoutDraftIsAbandoned(order, Date.now())
    ) {
      return null;
    }

    const lines = await ctx.db
      .query("orderLineItems")
      .withIndex("by_orderRef", (q) => q.eq("orderRef", args.orderRef))
      .collect();

    return checkoutResult(order, lines);
  }
});

export const createPosSaleDraft = mutation({
  args: {
    admission: v.optional(posAdmission),
    lines: v.array(posSaleLine),
    customerEmail: v.optional(v.string()),
    readerId: v.optional(v.string()),
    terminalLocationId: v.optional(v.string()),
    idempotencyKey: v.string()
  },
  handler: async (ctx, args) => {
    const staffUser = await requireStaffUser(ctx, ["admin", "pos"]);
    const now = Date.now();
    const authorizedReader = authorizeTerminalReaderSelection(
      { readerId: args.readerId, terminalLocationId: args.terminalLocationId },
      process.env.SKYLA_TERMINAL_READER_REGISTRY
    );
    const authorizedArgs = {
      ...args,
      readerId: authorizedReader.readerId,
      terminalLocationId: authorizedReader.terminalLocationId
    };
    const pendingWrite = buildPosSaleDraftWrite(authorizedArgs, {
      saleRef: "pending",
      now,
      staffUserId: staffUser._id,
      actorRole: staffUser.role
    });
    const existingSale = await ctx.db
      .query("posSales")
      .withIndex("by_staff_idempotencyKey", (q) =>
        q.eq("staffUserId", staffUser._id).eq("idempotencyKey", pendingWrite.input.idempotencyKey)
      )
      .first();

    if (existingSale) {
      // The fingerprint includes the selected visit and age counts, so a
      // retry returns the same sale and hold and can never move them.
      assertSameDraftFingerprint(existingSale.draftFingerprint, pendingWrite.draftFingerprint);
      const existingLines = await ctx.db
        .query("posSaleLines")
        .withIndex("by_saleRef", (q) => q.eq("saleRef", existingSale.saleRef))
        .collect();
      return posSaleDraftResult(existingSale, existingLines);
    }

    // Purchase-time gate for admission: real LA date, offered entry time
    // inside hours, and not already past today. Cafe-only sales skip it.
    const admission = pendingWrite.input.admission;
    const hours = admission ? await loadVenueHours(ctx) : undefined;
    if (admission) assertBookableVisitSlot(hours!, admission.visitDate, admission.entryTime, now);

    const expiresAt = now + posDraftTtlMs;
    const saleId = await ctx.db.insert("posSales", { ...pendingWrite.sale, expiresAt });
    const saleRef = saleRefFromId(saleId, now);
    const write = buildPosSaleDraftWrite(authorizedArgs, {
      saleRef,
      now,
      staffUserId: staffUser._id,
      actorRole: staffUser.role
    });

    await ctx.db.patch(saleId, { saleRef });
    for (const line of write.lines) {
      await ctx.db.insert("posSaleLines", line);
    }
    const partySize = ticketPartySize(write.lines);
    if (admission) {
      // Same transaction and the same indexed reads as online and private
      // events: racing last-place requests cannot exceed 30 people.
      await placeCapacityHold(ctx, {
        saleRef,
        visitDate: admission.visitDate,
        entryTime: admission.entryTime,
        partySize,
        status: "draft",
        hours: hours!,
        now
      });
    }
    await ctx.scheduler.runAt(expiresAt, internal.orderDrafts.expirePosSaleDraft, { saleRef });

    await ctx.db.insert("auditEvents", {
      actorStaffUserId: staffUser._id,
      action: "pos.saleDraft.create",
      entityType: "posSale",
      entityRef: saleRef,
      metadata: withoutUndefinedMetadata({
        totalCents: write.sale.totalCents,
        lineCount: write.lines.length,
        partySize: admission ? partySize : undefined,
        visitDate: admission?.visitDate,
        entryTime: admission?.entryTime
      }),
      createdAt: now
    });

    return posSaleDraftResult({ ...write.sale, expiresAt }, write.lines);
  }
});

/**
 * Releases a reviewed register sale the cashier changed or cleared. Only a
 * still-draft sale with no Terminal attempt is released; anything that may
 * have reached Stripe is never touched here.
 */
export const releasePosSaleDraft = mutation({
  args: { saleRef: v.string(), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    const staffUser = await requireStaffUser(ctx, ["admin", "pos"]);
    const idempotencyKey = normalizeIdempotencyKey(args.idempotencyKey);
    const sale = await ctx.db
      .query("posSales")
      .withIndex("by_saleRef", (q) => q.eq("saleRef", args.saleRef))
      .unique();
    if (!sale || sale.idempotencyKey !== idempotencyKey) {
      return { released: false as const };
    }
    if (staffUser.role !== "admin" && sale.staffUserId && sale.staffUserId !== staffUser._id) {
      throw new Error("POS sale belongs to a different staff user");
    }
    if (sale.status !== "draft") {
      return { released: false as const, status: sale.status };
    }
    if (await posTerminalAttemptExists(ctx, sale.saleRef)) {
      return { released: false as const, status: sale.status };
    }
    const now = Date.now();
    await ctx.db.patch(sale._id, { status: "canceled", customerEmailLower: undefined, updatedAt: now });
    const release = await releaseUnpaidCapacityHold(ctx, { saleRef: sale.saleRef }, "pos_draft_released", now);
    await ctx.db.insert("auditEvents", {
      actorStaffUserId: staffUser._id,
      action: "pos.saleDraft.release",
      entityType: "posSale",
      entityRef: sale.saleRef,
      metadata: { holdReleased: release.released, totalCents: sale.totalCents },
      createdAt: now
    });
    return { released: true as const };
  }
});

export const expirePosSaleDraft = internalMutation({
  args: { saleRef: v.string() },
  handler: async (ctx, args) => {
    const sale = await ctx.db
      .query("posSales")
      .withIndex("by_saleRef", (q) => q.eq("saleRef", args.saleRef))
      .unique();
    const now = Date.now();
    if (!sale || sale.status !== "draft" || sale.expiresAt === undefined || sale.expiresAt > now) {
      return { expired: false };
    }
    // A draft with any Terminal attempt is payment_pending; this is defensive.
    if (await posTerminalAttemptExists(ctx, sale.saleRef)) return { expired: false };
    await ctx.db.patch(sale._id, { status: "expired", customerEmailLower: undefined, updatedAt: now });
    await releaseUnpaidCapacityHold(ctx, { saleRef: sale.saleRef }, "pos_draft_expired", now);
    return { expired: true };
  }
});

async function posTerminalAttemptExists(ctx: MutationCtx, saleRef: string) {
  const attempt = await ctx.db
    .query("terminalPaymentAttempts")
    .withIndex("by_saleRef", (query) => query.eq("saleRef", saleRef))
    .first();
  return attempt !== null;
}

function withoutUndefinedMetadata(value: Record<string, string | number | boolean | undefined>) {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
  );
}

export const getPosSaleDraft = query({
  args: {
    saleRef: v.string()
  },
  handler: async (ctx, args) => {
    await requireStaffUser(ctx, ["admin", "pos", "viewer"]);

    const sale = await ctx.db
      .query("posSales")
      .withIndex("by_saleRef", (q) => q.eq("saleRef", args.saleRef))
      .unique();
    if (!sale) {
      return null;
    }

    const lines = await ctx.db
      .query("posSaleLines")
      .withIndex("by_saleRef", (q) => q.eq("saleRef", args.saleRef))
      .collect();

    return posSaleDraftResult(sale, lines);
  }
});

function checkoutResult(
  order: Parameters<typeof checkoutDraftResult>[0] & { createdAt: number; expiresAt?: number },
  lines: Parameters<typeof checkoutDraftResult>[1]
) {
  return {
    ...checkoutDraftResult(order, lines),
    expiresAt: checkoutDraftExpiresAt(order)
  };
}
