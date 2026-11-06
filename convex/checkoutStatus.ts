import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { assertBookingPaid } from "./lib/admission";
import {
  normalizeCheckoutReturnIdentity,
  projectCheckoutAttemptStatus,
  projectCheckoutReturnStatus
} from "./lib/checkoutReturnStatus";
import { lookupBookingAdmission } from "./lib/occupancy";
import { hasOpenBillingExceptionForOrder } from "./lib/operationsExceptions";
import { normalizeIdempotencyKey } from "./lib/orderDraftPersistence";

type PaymentEvent = Doc<"paymentEvents">;
type PaymentStatus = PaymentEvent["status"];

const paymentStatuses: PaymentStatus[] = ["created", "requires_payment", "processing", "paid", "failed", "refunded", "canceled"];
// Per-status bound. A subset that overflows without a matching row cannot
// prove the state is absent, so the guest is sent to staff, never to pay again.
const statusReadLimit = 50;
// Ownership-critical Session states: any foreign row, or more rows than can
// be read, makes the Session's owner unprovable.
const ownershipStatuses = new Set<PaymentStatus>(["created", "paid"]);

/**
 * One Session's payment states, read per status on the exact provider
 * payment id index. A row of another owner, an overflowing created/paid
 * subset, or an overflowing subset with no own row is never ignored.
 */
async function sessionPaymentStatuses(ctx: QueryCtx, sessionId: string, orderRef: string) {
  const groups = await Promise.all(
    paymentStatuses.map((status) =>
      ctx.db
        .query("paymentEvents")
        .withIndex("by_provider_providerPaymentId_status", (q) =>
          q.eq("provider", "stripe").eq("providerPaymentId", sessionId).eq("status", status)
        )
        .take(statusReadLimit + 1)
    )
  );
  const present: PaymentStatus[] = [];
  let unverified = false;
  groups.forEach((rows, index) => {
    const status = paymentStatuses[index];
    const own = rows.filter((row) => row.orderRef === orderRef && row.saleRef === undefined);
    if (own.length !== rows.length) unverified = true;
    if (own.length > 0) present.push(status);
    if (rows.length > statusReadLimit && (ownershipStatuses.has(status) || own.length === 0)) unverified = true;
  });
  return { present, unverified };
}

async function orderAttempts(ctx: QueryCtx, orderRef: string) {
  return ctx.db
    .query("checkoutPaymentAttempts")
    .withIndex("by_orderRef", (q) => q.eq("orderRef", orderRef))
    .take(2);
}

/**
 * Which payment states an order has, read one indexed status subset at a
 * time: decline history can never hide a created Session or a paid record.
 */
async function orderPaymentStatuses(ctx: QueryCtx, orderRef: string, matches: (row: PaymentEvent) => boolean) {
  const groups = await Promise.all(
    paymentStatuses.map((status) =>
      ctx.db
        .query("paymentEvents")
        .withIndex("by_orderRef_status", (q) => q.eq("orderRef", orderRef).eq("status", status))
        .take(statusReadLimit + 1)
    )
  );
  const present: PaymentStatus[] = [];
  let unverified = false;
  groups.forEach((rows, index) => {
    if (rows.some(matches)) present.push(paymentStatuses[index]);
    else if (rows.length > statusReadLimit) unverified = true;
  });
  return { present, unverified };
}

/**
 * Bounded booking/delivery reads for a confirmed projection. Confirmation
 * needs the booking's canonical money proof; the bearer code is offered only
 * while it can still admit the party (never after redemption).
 */
async function confirmedEntitlement(ctx: QueryCtx, orderRef: string, bookings: Array<Doc<"bookings">>) {
  if (bookings.length !== 1) return { ok: false as const };
  const booking = bookings[0];
  try {
    await assertBookingPaid(ctx, booking);
  } catch {
    return { ok: false as const };
  }
  const deliveries = await ctx.db
    .query("ticketDeliveries")
    .withIndex("by_bookingRef", (q) => q.eq("bookingRef", booking.bookingRef))
    .take(2);
  if (deliveries.length > 1) return { ok: false as const };
  const delivery = deliveries[0];
  const admission = await lookupBookingAdmission(ctx, booking.bookingRef);
  if (admission.kind === "duplicate") return { ok: false as const };
  const usable =
    booking.status === "confirmed" &&
    booking.checkedInAt === undefined &&
    admission.kind === "none" &&
    delivery?.orderRef === orderRef &&
    delivery.saleRef === undefined;
  return {
    ok: true as const,
    bookingRef: booking.bookingRef,
    ticketCode: usable && delivery ? delivery.ticketCode : undefined
  };
}

async function orderBookings(ctx: QueryCtx, orderRef: string) {
  return ctx.db
    .query("bookings")
    .withIndex("by_orderRef", (q) => q.eq("orderRef", orderRef))
    .take(2);
}

export const getCheckoutReturnStatus = query({
  args: {
    checkoutSessionId: v.string()
  },
  handler: async (ctx, args) => {
    const identity = normalizeCheckoutReturnIdentity(args.checkoutSessionId);
    const sessionId = identity.checkoutSessionId;
    // Session ownership comes from the Convex attempt and the Session's own
    // `created` rows, read on the exact provider payment id index so no
    // amount of other history can hide a second claimant.
    const [attempts, createdRows] = await Promise.all([
      ctx.db
        .query("checkoutPaymentAttempts")
        .withIndex("by_providerSessionId", (q) => q.eq("providerSessionId", sessionId))
        .take(2),
      ctx.db
        .query("paymentEvents")
        .withIndex("by_provider_providerPaymentId_status", (q) =>
          q.eq("provider", "stripe").eq("providerPaymentId", sessionId).eq("status", "created")
        )
        .take(statusReadLimit + 1)
    ]);
    const createdOverflow = createdRows.length > statusReadLimit;
    const createdOwnerless = createdRows.some((event) => !event.orderRef || event.saleRef !== undefined);
    const refs = new Set([
      ...attempts.map((attempt) => attempt.orderRef),
      ...createdRows.flatMap((event) => (event.orderRef ? [event.orderRef] : []))
    ]);
    if (refs.size === 0 && !createdOverflow && !createdOwnerless) throw new Error("Checkout payment was not found");
    if (refs.size !== 1 || attempts.length > 1 || createdOverflow || createdOwnerless) {
      // A Session claimed by more than one owner, or whose claimants cannot
      // all be read: never confirm, never guess. Only a single Convex attempt
      // may name the order back.
      return { orderRef: attempts.length === 1 ? attempts[0].orderRef : "", status: "needs_attention" as const };
    }
    const orderRef = [...refs][0];
    const orders = await ctx.db.query("orders").withIndex("by_orderRef", (q) => q.eq("orderRef", orderRef)).take(2);
    if (!orders[0] || orders[0].channel !== "online" || !createdRows.some((event) => event.orderRef === orderRef)) {
      throw new Error("Checkout payment was not found");
    }
    if (orders.length > 1) return { orderRef, status: "needs_attention" as const };
    const order = orders[0];

    const [statuses, bookings, billingOpen, orderAttemptRows] = await Promise.all([
      sessionPaymentStatuses(ctx, sessionId, orderRef),
      orderBookings(ctx, orderRef),
      hasOpenBillingExceptionForOrder(ctx, orderRef),
      orderAttempts(ctx, orderRef)
    ]);
    const status = projectCheckoutReturnStatus({
      orderStatus: order.status,
      paymentStatuses: statuses.present,
      bookingExists: bookings.length > 0,
      needsAttention:
        billingOpen ||
        orderAttemptRows.length > 1 ||
        orderAttemptRows[0]?.status === "exception" ||
        statuses.unverified ||
        bookings.length > 1
    });
    if (status !== "confirmed") return { orderRef, status };
    const entitlement = await confirmedEntitlement(ctx, orderRef, bookings);
    if (!entitlement.ok) return { orderRef, status: "needs_attention" as const };
    return {
      orderRef,
      status,
      bookingRef: entitlement.bookingRef,
      ...(entitlement.ticketCode ? { ticketCode: entitlement.ticketCode } : {})
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
    const orders = orderRef.length > 0 && orderRef.length <= 80
      ? await ctx.db
          .query("orders")
          .withIndex("by_orderRef", (q) => q.eq("orderRef", orderRef))
          .take(2)
      : [];
    const order = orders[0];
    if (!order || order.channel !== "online" || order.idempotencyKey !== idempotencyKey) {
      throw new Error("Checkout payment was not found");
    }
    if (orders.length > 1) return { orderRef, status: "needs_attention" as const };

    const [attemptRows, statuses, bookings, billingOpen] = await Promise.all([
      orderAttempts(ctx, orderRef),
      orderPaymentStatuses(ctx, orderRef, (row) => row.provider === "stripe"),
      orderBookings(ctx, orderRef),
      hasOpenBillingExceptionForOrder(ctx, orderRef)
    ]);
    // Two stored attempts for one order: never pick one.
    if (attemptRows.length > 1) return { orderRef, status: "needs_attention" as const };
    const attempt = attemptRows[0];
    const hasCreatedSession = statuses.present.includes("created");
    const status = projectCheckoutAttemptStatus({
      orderStatus: order.status,
      attempt: attempt
        ? { status: attempt.status, expiresAt: attempt.expiresAt }
        : hasCreatedSession
          ? { status: "legacy", expiresAt: 0 }
          : undefined,
      paymentStatuses: statuses.present,
      bookingExists: bookings.length > 0,
      // A created Session or paid record that cannot be ruled out keeps the
      // guest away from a second purchase.
      needsAttention: billingOpen || statuses.unverified || bookings.length > 1,
      now: Date.now()
    });
    if (status === "confirmed") {
      const entitlement = await confirmedEntitlement(ctx, orderRef, bookings);
      if (!entitlement.ok) return { orderRef, status: "needs_attention" as const };
      return {
        orderRef,
        status,
        bookingRef: entitlement.bookingRef,
        ...(entitlement.ticketCode ? { ticketCode: entitlement.ticketCode } : {})
      };
    }
    return {
      orderRef,
      status,
      ...(status === "awaiting_payment" && attempt ? { expiresAt: attempt.expiresAt } : {})
    };
  }
});
