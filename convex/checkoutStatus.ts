import { v } from "convex/values";

import { query } from "./_generated/server";
import {
  normalizeCheckoutReturnIdentity,
  projectCheckoutAttemptStatus,
  projectCheckoutReturnStatus
} from "./lib/checkoutReturnStatus";
import { openBillingExceptionsForOrder } from "./lib/operationsExceptions";
import { normalizeIdempotencyKey } from "./lib/orderDraftPersistence";

export const getCheckoutReturnStatus = query({
  args: {
    checkoutSessionId: v.string()
  },
  handler: async (ctx, args) => {
    const identity = normalizeCheckoutReturnIdentity(args.checkoutSessionId);
    const providerEvents = await ctx.db
      .query("paymentEvents")
      .withIndex("by_provider_providerPaymentId", (q) =>
        q.eq("provider", "stripe").eq("providerPaymentId", identity.checkoutSessionId)
      )
      .collect();
    const createdOrderRefs = Array.from(new Set(
      providerEvents
        .filter((event) => event.status === "created" && event.orderRef)
        .map((event) => event.orderRef as string)
    ));
    if (createdOrderRefs.length !== 1) {
      throw new Error("Checkout payment was not found");
    }
    const orderRef = createdOrderRefs[0];
    const matchingEvents = providerEvents.filter((event) => event.orderRef === orderRef);

    const order = await ctx.db
      .query("orders")
      .withIndex("by_orderRef", (q) => q.eq("orderRef", orderRef))
      .unique();
    if (!order || order.channel !== "online") {
      throw new Error("Checkout payment was not found");
    }

    const booking = await ctx.db
      .query("bookings")
      .withIndex("by_orderRef", (q) => q.eq("orderRef", orderRef))
      .unique();
    const [openBilling, attempt] = await Promise.all([
      openBillingExceptionsForOrder(ctx, orderRef),
      ctx.db
        .query("checkoutPaymentAttempts")
        .withIndex("by_orderRef", (q) => q.eq("orderRef", orderRef))
        .first()
    ]);

    const status = projectCheckoutReturnStatus({
        orderStatus: order.status,
        paymentStatuses: matchingEvents.map((event) => event.status),
        bookingExists: Boolean(booking),
        needsAttention: openBilling.length > 0 || attempt?.status === "exception"
      });
    const delivery = booking
      ? await ctx.db
          .query("ticketDeliveries")
          .withIndex("by_bookingRef", (q) => q.eq("bookingRef", booking.bookingRef))
          .unique()
      : null;

    return {
      orderRef,
      status,
      ...(status === "confirmed" && booking
        ? {
            bookingRef: booking.bookingRef,
            ...(delivery ? { ticketCode: delivery.ticketCode } : {})
          }
        : {})
    };
  }
});

/**
 * Lets the browser that started a payment recover its state after a reload,
 * a cancelled Stripe page or a lost response. It needs the order's private
 * idempotency key, reads only stored state, and returns no personal data.
 */
export const getCheckoutAttemptStatus = query({
  args: {
    orderRef: v.string(),
    idempotencyKey: v.string()
  },
  handler: async (ctx, args) => {
    const orderRef = args.orderRef.trim();
    let idempotencyKey: string;
    try {
      idempotencyKey = normalizeIdempotencyKey(args.idempotencyKey);
    } catch {
      throw new Error("Checkout payment was not found");
    }
    const order = orderRef.length > 0 && orderRef.length <= 80
      ? await ctx.db
          .query("orders")
          .withIndex("by_orderRef", (q) => q.eq("orderRef", orderRef))
          .unique()
      : null;
    if (!order || order.channel !== "online" || order.idempotencyKey !== idempotencyKey) {
      throw new Error("Checkout payment was not found");
    }

    const [attempt, payments, booking, openBilling] = await Promise.all([
      ctx.db
        .query("checkoutPaymentAttempts")
        .withIndex("by_orderRef", (q) => q.eq("orderRef", orderRef))
        .first(),
      ctx.db
        .query("paymentEvents")
        .withIndex("by_orderRef", (q) => q.eq("orderRef", orderRef))
        .take(50),
      ctx.db
        .query("bookings")
        .withIndex("by_orderRef", (q) => q.eq("orderRef", orderRef))
        .unique(),
      openBillingExceptionsForOrder(ctx, orderRef)
    ]);
    const hasCreatedSession = payments.some((event) => event.provider === "stripe" && event.status === "created");
    const status = projectCheckoutAttemptStatus({
      orderStatus: order.status,
      attempt: attempt
        ? { status: attempt.status, expiresAt: attempt.expiresAt }
        : hasCreatedSession
          ? { status: "legacy", expiresAt: 0 }
          : undefined,
      paymentStatuses: payments.filter((event) => event.provider === "stripe").map((event) => event.status),
      bookingExists: Boolean(booking),
      needsAttention: openBilling.length > 0,
      now: Date.now()
    });
    const delivery = status === "confirmed" && booking
      ? await ctx.db
          .query("ticketDeliveries")
          .withIndex("by_bookingRef", (q) => q.eq("bookingRef", booking.bookingRef))
          .unique()
      : null;

    return {
      orderRef,
      status,
      ...(status === "awaiting_payment" && attempt ? { expiresAt: attempt.expiresAt } : {}),
      ...(status === "confirmed" && booking
        ? { bookingRef: booking.bookingRef, ...(delivery ? { ticketCode: delivery.ticketCode } : {}) }
        : {})
    };
  }
});
