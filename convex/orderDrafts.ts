import { orderRefFromId, saleRefFromId } from "@skyla/payments";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireStaffUser } from "./lib/auth";
import {
  assertCheckoutDraftCanStartPayment,
  checkoutDraftExpiresAt,
  checkoutDraftIsAbandoned,
  checkoutDraftTtlMs
} from "./lib/checkoutDraftExpiry";
import {
  assertSameDraftFingerprint,
  buildCheckoutDraftWrite,
  buildPosSaleDraftWrite,
  checkoutDraftResult,
  normalizeIdempotencyKey,
  posSaleDraftResult
} from "./lib/orderDraftPersistence";
import { assertCheckoutTimeAvailable, safeOperatingHours } from "./lib/operatingHours";
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

const posSaleLine = v.union(
  v.object({
    kind: v.literal("ticket"),
    packageKey: ticketPackageKey,
    quantity: v.optional(v.number())
  }),
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

    const hoursRow = await ctx.db
      .query("config")
      .withIndex("by_key", (q) => q.eq("key", "hours"))
      .unique();
    assertCheckoutTimeAvailable(
      safeOperatingHours(hoursRow?.data),
      pendingWrite.input.visitDate,
      pendingWrite.input.entryTime
    );

    const expiresAt = now + checkoutDraftTtlMs;
    const orderId = await ctx.db.insert("orders", { ...pendingWrite.order, expiresAt });
    const orderRef = orderRefFromId(orderId, now);
    const write = buildCheckoutDraftWrite(args, { orderRef, now });

    await ctx.db.patch(orderId, { orderRef });
    for (const line of write.lines) {
      await ctx.db.insert("orderLineItems", line);
    }

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
    return { expired: true };
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
      assertSameDraftFingerprint(existingSale.draftFingerprint, pendingWrite.draftFingerprint);
      const existingLines = await ctx.db
        .query("posSaleLines")
        .withIndex("by_saleRef", (q) => q.eq("saleRef", existingSale.saleRef))
        .collect();
      return posSaleDraftResult(existingSale, existingLines);
    }

    const saleId = await ctx.db.insert("posSales", pendingWrite.sale);
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

    await ctx.db.insert("auditEvents", {
      actorStaffUserId: staffUser._id,
      action: "pos.saleDraft.create",
      entityType: "posSale",
      entityRef: saleRef,
      metadata: {
        totalCents: write.sale.totalCents,
        lineCount: write.lines.length
      },
      createdAt: now
    });

    return posSaleDraftResult(write.sale, write.lines);
  }
});

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
