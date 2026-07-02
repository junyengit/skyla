import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { requireStaffUser } from "./lib/auth";
import type { StripeCheckoutSnapshot } from "./lib/stripeCheckout";
import {
  stripeTerminalIntentIdempotencyKey,
  stripeTerminalProcessIdempotencyKey,
  type StripeTerminalProcessSnapshot,
  type StripeTerminalSnapshot
} from "./lib/stripeTerminal";
import {
  stripeCheckoutOrderStatusAfterUnpaidOutcome,
  stripeTerminalSaleStatusAfterUnpaidOutcome
} from "./lib/stripeWebhook";
import { authorizeTerminalReaderSelection } from "./lib/terminalReaderRegistry";

declare const process: { env: Record<string, string | undefined> };

const terminalProcessReservationTtlMs = 2 * 60 * 1000;

export const getCheckoutPaymentSnapshot = internalQuery({
  args: {
    orderRef: v.string(),
    idempotencyKey: v.string()
  },
  handler: async (ctx, args): Promise<StripeCheckoutSnapshot> => {
    const order = await ctx.db
      .query("orders")
      .withIndex("by_orderRef", (q) => q.eq("orderRef", args.orderRef))
      .unique();
    if (!order || order.channel !== "online" || order.idempotencyKey !== args.idempotencyKey) {
      throw new Error("Checkout order was not found for this payment attempt");
    }
    if (order.status !== "draft" && order.status !== "payment_pending") {
      throw new Error(`Checkout order cannot create a Stripe session from status ${order.status}`);
    }

    const lines = await ctx.db
      .query("orderLineItems")
      .withIndex("by_orderRef", (q) => q.eq("orderRef", args.orderRef))
      .collect();

    return {
      orderRef: order.orderRef,
      currency: order.currency,
      subtotalCents: order.subtotalCents,
      feeCents: order.feeCents,
      totalCents: order.totalCents,
      customerEmailLower: order.customerEmailLower,
      visitDate: order.visitDate,
      entryTime: order.entryTime,
      lines: lines.map((line) => ({
        name: line.name,
        quantity: line.quantity,
        unitAmountCents: line.unitAmountCents,
        lineTotalCents: line.lineTotalCents
      }))
    };
  }
});

export const recordStripeCheckoutSession = internalMutation({
  args: {
    orderRef: v.string(),
    providerPaymentId: v.string(),
    idempotencyKey: v.string(),
    amountCents: v.number(),
    currency: v.literal("usd"),
    raw: v.optional(v.any())
  },
  handler: async (ctx, args) => {
    const existingEvent = await ctx.db
      .query("paymentEvents")
      .withIndex("by_provider_idempotencyKey", (q) =>
        q.eq("provider", "stripe").eq("idempotencyKey", args.idempotencyKey)
      )
      .first();

    if (existingEvent) {
      if (
        existingEvent.orderRef !== args.orderRef ||
        existingEvent.providerPaymentId !== args.providerPaymentId ||
        existingEvent.amountCents !== args.amountCents ||
        existingEvent.currency !== args.currency
      ) {
        throw new Error("Stripe checkout idempotency key was reused for a different payment");
      }
      return { eventId: existingEvent._id, reused: true };
    }

    const order = await ctx.db
      .query("orders")
      .withIndex("by_orderRef", (q) => q.eq("orderRef", args.orderRef))
      .unique();
    if (!order) {
      throw new Error("Checkout order disappeared before payment recording");
    }
    if (order.totalCents !== args.amountCents || order.currency !== args.currency) {
      throw new Error("Stripe checkout amount does not match the stored order");
    }

    const now = Date.now();
    const eventId = await ctx.db.insert("paymentEvents", {
      orderRef: args.orderRef,
      provider: "stripe",
      providerPaymentId: args.providerPaymentId,
      idempotencyKey: args.idempotencyKey,
      status: "created",
      currency: args.currency,
      amountCents: args.amountCents,
      raw: args.raw,
      createdAt: now
    });

    await ctx.db.patch(order._id, {
      status: "payment_pending",
      expectedProvider: "stripe",
      updatedAt: now
    });

    return { eventId, reused: false };
  }
});

export const getPosTerminalPaymentSnapshot = internalQuery({
  args: {
    saleRef: v.string(),
    idempotencyKey: v.string()
  },
  handler: async (ctx, args): Promise<StripeTerminalSnapshot & { actorStaffUserId: Id<"staffUsers"> }> => {
    const staffUser = await requireStaffUser(ctx, ["admin", "pos"]);
    const idempotencyKey = args.idempotencyKey.trim();
    if (!idempotencyKey) {
      throw new Error("POS sale idempotency key is required");
    }

    const sale = await ctx.db
      .query("posSales")
      .withIndex("by_saleRef", (q) => q.eq("saleRef", args.saleRef))
      .unique();
    if (!sale || sale.idempotencyKey !== idempotencyKey) {
      throw new Error("POS sale was not found for this payment attempt");
    }
    if (sale.status !== "draft" && sale.status !== "payment_pending") {
      throw new Error(`POS sale cannot create a Terminal intent from status ${sale.status}`);
    }
    if (staffUser.role !== "admin" && sale.staffUserId && sale.staffUserId !== staffUser._id) {
      throw new Error("POS sale belongs to a different staff user");
    }

    const lines = await ctx.db
      .query("posSaleLines")
      .withIndex("by_saleRef", (q) => q.eq("saleRef", args.saleRef))
      .collect();
    const authorizedReader = authorizeTerminalReaderSelection(
      { readerId: sale.readerId, terminalLocationId: sale.terminalLocationId },
      process.env.SKYLA_TERMINAL_READER_REGISTRY
    );

    return {
      actorStaffUserId: staffUser._id,
      saleRef: sale.saleRef,
      currency: sale.currency,
      subtotalCents: sale.subtotalCents,
      feeCents: sale.feeCents,
      totalCents: sale.totalCents,
      customerEmailLower: sale.customerEmailLower,
      readerId: authorizedReader.readerId,
      terminalLocationId: authorizedReader.terminalLocationId,
      lines: lines.map((line) => ({
        name: line.name,
        quantity: line.quantity,
        unitAmountCents: line.unitAmountCents,
        lineTotalCents: line.lineTotalCents
      }))
    };
  }
});

export const recordStripeTerminalPaymentIntent = internalMutation({
  args: {
    saleRef: v.string(),
    providerPaymentId: v.string(),
    idempotencyKey: v.string(),
    amountCents: v.number(),
    currency: v.literal("usd"),
    actorStaffUserId: v.id("staffUsers"),
    raw: v.optional(v.any())
  },
  handler: async (ctx, args) => {
    const existingEvent = await ctx.db
      .query("paymentEvents")
      .withIndex("by_provider_idempotencyKey", (q) =>
        q.eq("provider", "terminal").eq("idempotencyKey", args.idempotencyKey)
      )
      .first();

    if (existingEvent) {
      if (
        existingEvent.saleRef !== args.saleRef ||
        existingEvent.providerPaymentId !== args.providerPaymentId ||
        existingEvent.amountCents !== args.amountCents ||
        existingEvent.currency !== args.currency
      ) {
        throw new Error("Stripe Terminal idempotency key was reused for a different payment");
      }
      return { eventId: existingEvent._id, reused: true };
    }

    const sale = await ctx.db
      .query("posSales")
      .withIndex("by_saleRef", (q) => q.eq("saleRef", args.saleRef))
      .unique();
    if (!sale) {
      throw new Error("POS sale disappeared before payment recording");
    }
    if (sale.totalCents !== args.amountCents || sale.currency !== args.currency) {
      throw new Error("Stripe Terminal amount does not match the stored POS sale");
    }
    if (sale.status !== "draft" && sale.status !== "payment_pending") {
      throw new Error(`POS sale cannot record a Terminal intent from status ${sale.status}`);
    }

    const now = Date.now();
    const eventId = await ctx.db.insert("paymentEvents", {
      saleRef: args.saleRef,
      provider: "terminal",
      providerPaymentId: args.providerPaymentId,
      idempotencyKey: args.idempotencyKey,
      status: "requires_payment",
      currency: args.currency,
      amountCents: args.amountCents,
      raw: args.raw,
      createdAt: now
    });

    await ctx.db.patch(sale._id, {
      status: "payment_pending",
      updatedAt: now
    });

    await ctx.db.insert("auditEvents", {
      actorStaffUserId: args.actorStaffUserId,
      action: "pos.terminalIntent.create",
      entityType: "posSale",
      entityRef: args.saleRef,
      metadata: {
        amountCents: args.amountCents,
        providerPaymentId: args.providerPaymentId
      },
      createdAt: now
    });

    return { eventId, reused: false };
  }
});

export const getStripeTerminalReaderProcessSnapshot = internalQuery({
  args: {
    saleRef: v.string(),
    idempotencyKey: v.string()
  },
  handler: async (
    ctx,
    args
  ): Promise<StripeTerminalProcessSnapshot & { actorStaffUserId: Id<"staffUsers"> }> => {
    const staffUser = await requireStaffUser(ctx, ["admin", "pos"]);
    const idempotencyKey = args.idempotencyKey.trim();
    if (!idempotencyKey) {
      throw new Error("POS sale idempotency key is required");
    }

    const sale = await ctx.db
      .query("posSales")
      .withIndex("by_saleRef", (q) => q.eq("saleRef", args.saleRef))
      .unique();
    if (!sale || sale.idempotencyKey !== idempotencyKey) {
      throw new Error("POS sale was not found for this reader process attempt");
    }
    if (sale.status !== "payment_pending") {
      throw new Error(`POS sale cannot be sent to a Terminal reader from status ${sale.status}`);
    }
    if (staffUser.role !== "admin" && sale.staffUserId && sale.staffUserId !== staffUser._id) {
      throw new Error("POS sale belongs to a different staff user");
    }
    if (!sale.readerId) {
      throw new Error("POS sale does not have a stored Terminal reader");
    }
    const authorizedReader = authorizeTerminalReaderSelection(
      { readerId: sale.readerId, terminalLocationId: sale.terminalLocationId },
      process.env.SKYLA_TERMINAL_READER_REGISTRY
    );

    const terminalEvent = await ctx.db
      .query("paymentEvents")
      .withIndex("by_provider_idempotencyKey", (q) =>
        q.eq("provider", "terminal").eq("idempotencyKey", stripeTerminalIntentIdempotencyKey(sale.saleRef))
      )
      .first();
    if (!terminalEvent || terminalEvent.saleRef !== sale.saleRef) {
      throw new Error("Terminal PaymentIntent was not created for this POS sale");
    }
    if (
      terminalEvent.status !== "requires_payment" &&
      terminalEvent.status !== "failed"
    ) {
      throw new Error(`Terminal PaymentIntent cannot be processed from status ${terminalEvent.status}`);
    }
    if (terminalEvent.amountCents !== sale.totalCents || terminalEvent.currency !== sale.currency) {
      throw new Error("Terminal PaymentIntent amount does not match the stored POS sale");
    }

    return {
      actorStaffUserId: staffUser._id,
      saleRef: sale.saleRef,
      paymentIntentId: terminalEvent.providerPaymentId,
      readerId: authorizedReader.readerId!,
      amountCents: sale.totalCents,
      currency: sale.currency
    };
  }
});

export const reserveStripeTerminalReaderProcessAttempt = internalMutation({
  args: {
    saleRef: v.string(),
    providerPaymentId: v.string(),
    readerId: v.string(),
    amountCents: v.number(),
    currency: v.literal("usd")
  },
  handler: async (ctx, args) => {
    const providerEvents = await ctx.db
      .query("paymentEvents")
      .withIndex("by_provider_providerPaymentId", (q) =>
        q.eq("provider", "terminal").eq("providerPaymentId", args.providerPaymentId)
      )
      .collect();
    const terminalEvent = providerEvents.find((event) => event.saleRef === args.saleRef);
    if (!terminalEvent) {
      throw new Error("Terminal PaymentIntent event was not found for reader processing");
    }
    if (
      terminalEvent.status !== "requires_payment" &&
      terminalEvent.status !== "failed"
    ) {
      throw new Error(`Terminal PaymentIntent cannot be processed from status ${terminalEvent.status}`);
    }
    if (terminalEvent.amountCents !== args.amountCents || terminalEvent.currency !== args.currency) {
      throw new Error("Terminal reader process amount does not match the payment event");
    }

    const now = Date.now();
    const existingRaw = terminalRawBase(terminalEvent.raw);
    if (terminalRawHasActiveProcessReservation(existingRaw, now)) {
      throw new Error("Terminal reader process attempt is already in progress");
    }

    const processAttempt = terminalRawLastProcessAttempt(existingRaw) + 1;
    const processIdempotencyKey = stripeTerminalProcessIdempotencyKey(
      args.saleRef,
      args.providerPaymentId,
      args.readerId,
      processAttempt
    );
    await ctx.db.patch(terminalEvent._id, {
      raw: {
        ...existingRaw,
        readerProcessAttempt: processAttempt,
        readerProcessIdempotencyKey: processIdempotencyKey,
        readerProcessReservedAt: now
      }
    });

    return { processAttempt, processIdempotencyKey };
  }
});

export const recordStripeTerminalReaderProcess = internalMutation({
  args: {
    saleRef: v.string(),
    providerPaymentId: v.string(),
    readerId: v.string(),
    amountCents: v.number(),
    currency: v.literal("usd"),
    processAttempt: v.number(),
    processIdempotencyKey: v.string(),
    status: v.union(v.literal("processing"), v.literal("paid"), v.literal("failed")),
    actorStaffUserId: v.id("staffUsers"),
    raw: v.optional(v.any())
  },
  handler: async (ctx, args) => {
    const providerEvents = await ctx.db
      .query("paymentEvents")
      .withIndex("by_provider_providerPaymentId", (q) =>
        q.eq("provider", "terminal").eq("providerPaymentId", args.providerPaymentId)
      )
      .collect();
    const terminalEvent = providerEvents.find((event) => event.saleRef === args.saleRef);
    if (!terminalEvent) {
      throw new Error("Terminal PaymentIntent event was not found for reader processing");
    }
    if (terminalEvent.amountCents !== args.amountCents || terminalEvent.currency !== args.currency) {
      throw new Error("Terminal reader process amount does not match the payment event");
    }

    const sale = await ctx.db
      .query("posSales")
      .withIndex("by_saleRef", (q) => q.eq("saleRef", args.saleRef))
      .unique();
    if (!sale) {
      throw new Error("POS sale disappeared before reader processing was recorded");
    }
    if (sale.totalCents !== args.amountCents || sale.currency !== args.currency) {
      throw new Error("Terminal reader process amount does not match the stored POS sale");
    }
    if (sale.readerId !== args.readerId) {
      throw new Error("Terminal reader process does not match the stored reader");
    }

    const now = Date.now();
    const existingRaw = terminalRawBase(terminalEvent.raw);
    if (existingRaw.readerProcessAttempt !== args.processAttempt) {
      throw new Error("Terminal reader process attempt was not reserved");
    }
    if (existingRaw.readerProcessIdempotencyKey !== args.processIdempotencyKey) {
      throw new Error("Terminal reader process idempotency key was not reserved");
    }
    const nextRaw = {
      ...existingRaw,
      readerProcessRecordedAt: now,
      ...(args.raw === undefined ? {} : { readerProcess: args.raw })
    };
    await ctx.db.patch(terminalEvent._id, {
      status: args.status,
      raw: nextRaw
    });

    if (args.status === "paid") {
      await ctx.db.patch(sale._id, {
        status: "paid",
        updatedAt: now
      });
    } else {
      await ctx.db.patch(sale._id, {
        status: "payment_pending",
        updatedAt: now
      });
    }

    await ctx.db.insert("auditEvents", {
      actorStaffUserId: args.actorStaffUserId,
      action: "pos.terminalReader.process",
      entityType: "posSale",
      entityRef: args.saleRef,
      metadata: {
        amountCents: args.amountCents,
        providerPaymentId: args.providerPaymentId,
        readerId: args.readerId,
        processAttempt: args.processAttempt,
        status: args.status
      },
      createdAt: now
    });

    return { eventId: terminalEvent._id, status: args.status };
  }
});

function terminalRawBase(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null) {
    return {};
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    if (
      "paymentIntent" in record ||
      "readerProcess" in record ||
      "readerProcessAttempt" in record ||
      "readerProcessIdempotencyKey" in record
    ) {
      return record;
    }
  }
  return { paymentIntent: raw };
}

function terminalRawLastProcessAttempt(raw: unknown) {
  const base = terminalRawBase(raw);
  const attempt = base.readerProcessAttempt;
  return typeof attempt === "number" && Number.isInteger(attempt) && attempt > 0 ? attempt : 0;
}

function terminalRawHasActiveProcessReservation(base: Record<string, unknown>, now: number) {
  const reservedAt = base.readerProcessReservedAt;
  if (typeof reservedAt !== "number" || !Number.isFinite(reservedAt)) {
    return false;
  }
  const recordedAt = base.readerProcessRecordedAt;
  const hasRecordedThisReservation =
    typeof recordedAt === "number" && Number.isFinite(recordedAt) && recordedAt >= reservedAt;
  return !hasRecordedThisReservation && now - reservedAt < terminalProcessReservationTtlMs;
}

export const recordStripeTerminalWebhook = internalMutation({
  args: {
    providerEventId: v.string(),
    eventType: v.string(),
    outcome: v.union(v.literal("paid"), v.literal("failed"), v.literal("canceled"), v.literal("ignored")),
    providerPaymentId: v.optional(v.string()),
    saleRef: v.optional(v.string()),
    amountCents: v.optional(v.number()),
    currency: v.optional(v.literal("usd")),
    raw: v.optional(v.any())
  },
  handler: async (ctx, args) => {
    const existingWebhook = await ctx.db
      .query("webhookEvents")
      .withIndex("by_provider_providerEventId", (q) =>
        q.eq("provider", "terminal").eq("providerEventId", args.providerEventId)
      )
      .first();
    if (existingWebhook) {
      return {
        status: existingWebhook.status,
        duplicate: true,
        saleRef: existingWebhook.saleRef
      };
    }

    if (args.outcome === "ignored") {
      await insertWebhookEvent(ctx, {
        provider: "terminal",
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "ignored",
        saleRef: args.saleRef,
        raw: args.raw
      });
      return { status: "ignored", duplicate: false, saleRef: args.saleRef };
    }

    if (!args.providerPaymentId || !args.saleRef) {
      await insertWebhookEvent(ctx, {
        provider: "terminal",
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "failed",
        saleRef: args.saleRef,
        raw: { ...(args.raw ?? {}), reason: "missing_provider_payment_or_sale_ref" }
      });
      return { status: "failed", duplicate: false, saleRef: args.saleRef };
    }
    if (args.amountCents === undefined || !args.currency) {
      await insertWebhookEvent(ctx, {
        provider: "terminal",
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "failed",
        saleRef: args.saleRef,
        raw: { ...(args.raw ?? {}), reason: "missing_terminal_amount_or_currency" }
      });
      return { status: "failed", duplicate: false, saleRef: args.saleRef };
    }

    const sale = await ctx.db
      .query("posSales")
      .withIndex("by_saleRef", (q) => q.eq("saleRef", args.saleRef as string))
      .unique();
    if (!sale) {
      await insertWebhookEvent(ctx, {
        provider: "terminal",
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "failed",
        saleRef: args.saleRef,
        raw: { ...(args.raw ?? {}), reason: "pos_sale_not_found" }
      });
      return { status: "failed", duplicate: false, saleRef: args.saleRef };
    }

    const providerEvents = await ctx.db
      .query("paymentEvents")
      .withIndex("by_provider_providerPaymentId", (q) =>
        q.eq("provider", "terminal").eq("providerPaymentId", args.providerPaymentId as string)
      )
      .collect();
    const expectedIntentKey = stripeTerminalIntentIdempotencyKey(args.saleRef);
    const terminalEvent =
      providerEvents.find((event) => event.saleRef === args.saleRef && event.idempotencyKey === expectedIntentKey) ??
      providerEvents.find((event) => event.saleRef === args.saleRef);
    if (!terminalEvent) {
      await insertWebhookEvent(ctx, {
        provider: "terminal",
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "failed",
        saleRef: args.saleRef,
        raw: { ...(args.raw ?? {}), reason: "terminal_intent_not_created_by_convex" }
      });
      return { status: "failed", duplicate: false, saleRef: args.saleRef };
    }

    const amountCents = args.amountCents;
    const currency = args.currency;
    if (
      sale.totalCents !== amountCents ||
      sale.currency !== currency ||
      terminalEvent.amountCents !== amountCents ||
      terminalEvent.currency !== currency
    ) {
      await insertWebhookEvent(ctx, {
        provider: "terminal",
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "failed",
        saleRef: args.saleRef,
        raw: { ...(args.raw ?? {}), reason: "amount_or_currency_mismatch" }
      });
      return { status: "failed", duplicate: false, saleRef: args.saleRef };
    }

    if (args.outcome !== "paid" && sale.status === "paid") {
      await insertWebhookEvent(ctx, {
        provider: "terminal",
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "failed",
        saleRef: args.saleRef,
        raw: { ...(args.raw ?? {}), reason: "pos_sale_already_paid" }
      });
      return { status: "failed", duplicate: false, saleRef: args.saleRef };
    }
    if (args.outcome !== "canceled" && sale.status === "canceled") {
      await insertWebhookEvent(ctx, {
        provider: "terminal",
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "failed",
        saleRef: args.saleRef,
        raw: { ...(args.raw ?? {}), reason: "pos_sale_already_canceled" }
      });
      return { status: "failed", duplicate: false, saleRef: args.saleRef };
    }

    if (
      (args.outcome === "paid" && sale.status !== "payment_pending" && sale.status !== "paid") ||
      (args.outcome !== "paid" && sale.status !== "payment_pending" && sale.status !== "canceled")
    ) {
      await insertWebhookEvent(ctx, {
        provider: "terminal",
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "failed",
        saleRef: args.saleRef,
        raw: { ...(args.raw ?? {}), reason: "pos_sale_status_not_reconcilable" }
      });
      return { status: "failed", duplicate: false, saleRef: args.saleRef };
    }

    if (args.outcome === "paid") {
      const now = Date.now();
      const existingPaidEvent = providerEvents.find((event) => event.saleRef === args.saleRef && event.status === "paid");
      if (!existingPaidEvent) {
        await ctx.db.insert("paymentEvents", {
          saleRef: args.saleRef,
          provider: "terminal",
          providerPaymentId: args.providerPaymentId,
          idempotencyKey: terminalEvent.idempotencyKey,
          status: "paid",
          currency,
          amountCents,
          rawEventId: args.providerEventId,
          raw: args.raw,
          createdAt: now
        });
      }

      if (terminalEvent.status !== "paid") {
        await ctx.db.patch(terminalEvent._id, {
          status: "paid",
          raw: withoutUndefined({
            ...terminalRawBase(terminalEvent.raw),
            terminalWebhookRecordedAt: now,
            terminalWebhook: args.raw
          })
        });
      }

      if (sale.status !== "paid") {
        await ctx.db.patch(sale._id, {
          status: "paid",
          updatedAt: now
        });
      }

      await insertTerminalWebhookAuditEvent(ctx, {
        saleRef: args.saleRef,
        outcome: args.outcome,
        amountCents,
        providerPaymentId: args.providerPaymentId,
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        createdAt: now
      });
      await insertWebhookEvent(ctx, {
        provider: "terminal",
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "processed",
        saleRef: args.saleRef,
        raw: args.raw
      });
      return { status: "processed", duplicate: false, saleRef: args.saleRef };
    }

    const now = Date.now();
    const providerStatus = args.outcome === "failed" ? "failed" : "canceled";
    await ctx.db.insert("paymentEvents", {
      saleRef: args.saleRef,
      provider: "terminal",
      providerPaymentId: args.providerPaymentId,
      idempotencyKey: terminalEvent.idempotencyKey,
      status: providerStatus,
      currency,
      amountCents,
      rawEventId: args.providerEventId,
      raw: args.raw,
      createdAt: now
    });

    if (terminalEvent.status !== providerStatus) {
      await ctx.db.patch(terminalEvent._id, {
        status: providerStatus,
        raw: withoutUndefined({
          ...terminalRawBase(terminalEvent.raw),
          terminalWebhookRecordedAt: now,
          terminalWebhook: args.raw
        })
      });
    }

    const nextSaleStatus = stripeTerminalSaleStatusAfterUnpaidOutcome(args.outcome);
    if (sale.status !== nextSaleStatus) {
      await ctx.db.patch(sale._id, {
        status: nextSaleStatus,
        updatedAt: now
      });
    }

    await insertTerminalWebhookAuditEvent(ctx, {
      saleRef: args.saleRef,
      outcome: args.outcome,
      amountCents,
      providerPaymentId: args.providerPaymentId,
      providerEventId: args.providerEventId,
      eventType: args.eventType,
      createdAt: now
    });
    await insertWebhookEvent(ctx, {
      provider: "terminal",
      providerEventId: args.providerEventId,
      eventType: args.eventType,
      status: "processed",
      saleRef: args.saleRef,
      raw: args.raw
    });
    return { status: "processed", duplicate: false, saleRef: args.saleRef };
  }
});

export const recordStripeCheckoutWebhook = internalMutation({
  args: {
    providerEventId: v.string(),
    eventType: v.string(),
    outcome: v.union(v.literal("paid"), v.literal("failed"), v.literal("canceled"), v.literal("ignored")),
    providerPaymentId: v.optional(v.string()),
    orderRef: v.optional(v.string()),
    amountCents: v.optional(v.number()),
    currency: v.optional(v.literal("usd")),
    raw: v.optional(v.any())
  },
  handler: async (ctx, args) => {
    const existingWebhook = await ctx.db
      .query("webhookEvents")
      .withIndex("by_provider_providerEventId", (q) =>
        q.eq("provider", "stripe").eq("providerEventId", args.providerEventId)
      )
      .first();
    if (existingWebhook) {
      return {
        status: existingWebhook.status,
        duplicate: true,
        orderRef: existingWebhook.orderRef
      };
    }

    if (args.outcome === "ignored") {
      await insertWebhookEvent(ctx, {
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "ignored",
        orderRef: args.orderRef,
        raw: args.raw
      });
      return { status: "ignored", duplicate: false, orderRef: args.orderRef };
    }

    if (!args.providerPaymentId || !args.orderRef) {
      await insertWebhookEvent(ctx, {
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "failed",
        orderRef: args.orderRef,
        raw: { ...(args.raw ?? {}), reason: "missing_provider_payment_or_order_ref" }
      });
      return { status: "failed", duplicate: false, orderRef: args.orderRef };
    }

    const order = await ctx.db
      .query("orders")
      .withIndex("by_orderRef", (q) => q.eq("orderRef", args.orderRef as string))
      .unique();
    if (!order) {
      await insertWebhookEvent(ctx, {
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "failed",
        orderRef: args.orderRef,
        raw: { ...(args.raw ?? {}), reason: "order_not_found" }
      });
      return { status: "failed", duplicate: false, orderRef: args.orderRef };
    }

    const providerEvents = await ctx.db
      .query("paymentEvents")
      .withIndex("by_provider_providerPaymentId", (q) =>
        q.eq("provider", "stripe").eq("providerPaymentId", args.providerPaymentId as string)
      )
      .collect();
    const creationEvent = providerEvents.find(
      (event) => event.orderRef === args.orderRef && event.status === "created"
    );
    if (!creationEvent) {
      await insertWebhookEvent(ctx, {
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "failed",
        orderRef: args.orderRef,
        raw: { ...(args.raw ?? {}), reason: "payment_session_not_created_by_convex" }
      });
      return { status: "failed", duplicate: false, orderRef: args.orderRef };
    }

    const amountCents = args.amountCents ?? creationEvent.amountCents;
    const currency = args.currency ?? creationEvent.currency;
    if (
      order.totalCents !== amountCents ||
      order.currency !== currency ||
      creationEvent.amountCents !== amountCents ||
      creationEvent.currency !== currency
    ) {
      await insertWebhookEvent(ctx, {
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "failed",
        orderRef: args.orderRef,
        raw: { ...(args.raw ?? {}), reason: "amount_or_currency_mismatch" }
      });
      return { status: "failed", duplicate: false, orderRef: args.orderRef };
    }
    if (order.expectedProvider !== "stripe") {
      await insertWebhookEvent(ctx, {
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "failed",
        orderRef: args.orderRef,
        raw: { ...(args.raw ?? {}), reason: "order_expected_provider_mismatch" }
      });
      return { status: "failed", duplicate: false, orderRef: args.orderRef };
    }
    if (order.status !== "payment_pending" && order.status !== "paid") {
      await insertWebhookEvent(ctx, {
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "failed",
        orderRef: args.orderRef,
        raw: { ...(args.raw ?? {}), reason: "order_status_not_payable" }
      });
      return { status: "failed", duplicate: false, orderRef: args.orderRef };
    }

    if (args.outcome === "paid") {
      const existingPaidEvent = providerEvents.find((event) => event.status === "paid");
      if (!existingPaidEvent) {
        await ctx.db.insert("paymentEvents", {
          orderRef: args.orderRef,
          provider: "stripe",
          providerPaymentId: args.providerPaymentId,
          idempotencyKey: creationEvent.idempotencyKey,
          status: "paid",
          currency,
          amountCents,
          rawEventId: args.providerEventId,
          raw: args.raw,
          createdAt: Date.now()
        });
      }

      if (order.status !== "paid") {
        await ctx.db.patch(order._id, {
          status: "paid",
          expectedProvider: "stripe",
          updatedAt: Date.now()
        });
      }

      await insertWebhookEvent(ctx, {
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "processed",
        orderRef: args.orderRef,
        raw: args.raw
      });
      return { status: "processed", duplicate: false, orderRef: args.orderRef };
    }

    const providerStatus = args.outcome === "failed" ? "failed" : "canceled";
    await ctx.db.insert("paymentEvents", {
      orderRef: args.orderRef,
      provider: "stripe",
      providerPaymentId: args.providerPaymentId,
      idempotencyKey: creationEvent.idempotencyKey,
      status: providerStatus,
      currency,
      amountCents,
      rawEventId: args.providerEventId,
      raw: args.raw,
      createdAt: Date.now()
    });

    if (order.status !== "paid") {
      await ctx.db.patch(order._id, {
        status: stripeCheckoutOrderStatusAfterUnpaidOutcome(args.outcome),
        expectedProvider: "stripe",
        updatedAt: Date.now()
      });
    }

    await insertWebhookEvent(ctx, {
      providerEventId: args.providerEventId,
      eventType: args.eventType,
      status: "processed",
      orderRef: args.orderRef,
      raw: args.raw
    });
    return { status: "processed", duplicate: false, orderRef: args.orderRef };
  }
});

async function insertWebhookEvent(
  ctx: MutationCtx,
  args: {
    provider?: "stripe" | "terminal";
    providerEventId: string;
    eventType: string;
    status: "processed" | "ignored" | "failed";
    orderRef?: string;
    saleRef?: string;
    raw?: unknown;
  }
) {
  await ctx.db.insert("webhookEvents", withoutUndefined({
    provider: args.provider ?? "stripe",
    providerEventId: args.providerEventId,
    eventType: args.eventType,
    processedAt: Date.now(),
    status: args.status,
    orderRef: args.orderRef,
    saleRef: args.saleRef,
    raw: args.raw
  }));
}

async function insertTerminalWebhookAuditEvent(
  ctx: MutationCtx,
  args: {
    saleRef: string;
    outcome: "paid" | "failed" | "canceled";
    amountCents: number;
    providerPaymentId: string;
    providerEventId: string;
    eventType: string;
    createdAt: number;
  }
) {
  await ctx.db.insert("auditEvents", {
    action: `pos.terminalWebhook.${args.outcome}`,
    entityType: "posSale",
    entityRef: args.saleRef,
    metadata: {
      amountCents: args.amountCents,
      providerPaymentId: args.providerPaymentId,
      providerEventId: args.providerEventId,
      eventType: args.eventType,
      status: args.outcome
    },
    createdAt: args.createdAt
  });
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
