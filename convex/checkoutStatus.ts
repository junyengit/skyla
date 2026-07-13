import { v } from "convex/values";

import { query } from "./_generated/server";
import { normalizeCheckoutReturnIdentity, projectCheckoutReturnStatus } from "./lib/checkoutReturnStatus";

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

    const status = projectCheckoutReturnStatus({
        orderStatus: order.status,
        paymentStatuses: matchingEvents.map((event) => event.status),
        bookingExists: Boolean(booking)
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
