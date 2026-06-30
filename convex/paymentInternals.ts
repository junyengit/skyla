import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";
import type { StripeCheckoutSnapshot } from "./lib/stripeCheckout";

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
