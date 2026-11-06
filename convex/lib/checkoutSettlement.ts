import { venueClock, venueDayMinutes, visitEntitlementWindow } from "@skyla/payments";

import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { bookingPaidProof } from "./admission";
import {
  holdPaidExceptionCapacity,
  loadVenueHours,
  lookupCapacityReservation,
  releaseUnpaidCapacityHold,
  settlePaidCapacity,
  VenueHoursIntegrityError
} from "./capacity";
import { buildConfirmedCheckoutFulfillment, type ConfirmedCheckoutBooking } from "./checkoutFulfillment";
import { openBillingExceptionsForOrder, openOperationsException } from "./operationsExceptions";
import { assertStoredPaymentLineProvenance } from "./orderDraftPersistence";
import {
  checkIntentOwnership,
  identityRows,
  paidIdentityForIntent,
  paidIdentityForProviderPayment,
  paidSummaryForOrder,
  samePaidRecord
} from "./paymentEvidence";
import { stripeCheckoutOrderStatusAfterUnpaidOutcome } from "./stripeWebhook";
import { assertTicketDeliveryReady, ensureTicketDelivery } from "./ticketDeliveryQueue";

type AttemptDoc = Doc<"checkoutPaymentAttempts">;
type OrderDoc = Doc<"orders">;

export type CheckoutPaidEvidence = {
  source: "webhook" | "reconciliation";
  providerEventId?: string;
  eventType: string;
  providerSessionId: string;
  providerPaymentIntentId?: string;
  orderRef: string;
  attemptNonce?: string;
  amountCents?: number;
  currency?: "usd";
  /** Stripe Session mode; anything other than "payment" never issues a ticket. */
  sessionMode?: string;
  livemode?: boolean;
  sessionStatus?: string;
  paymentStatus?: string;
  /** Signed provider time of the paid event; processing time when unknown. */
  paidAt?: number;
  ticketCode?: string;
  raw?: unknown;
};

export type CheckoutPaidResult =
  | { kind: "fulfilled"; bookingRef: string; repeated: boolean }
  | { kind: "exception"; code: string; moneyRecorded: boolean }
  | { kind: "ignored"; reason: string };

export type CheckoutUnpaidEvidence = {
  source: "webhook" | "reconciliation";
  providerEventId?: string;
  eventType: string;
  outcome: "failed" | "canceled";
  providerSessionId: string;
  orderRef: string;
  attemptNonce?: string;
  amountCents?: number;
  currency?: "usd";
  sessionMode?: string;
  livemode?: boolean;
  sessionStatus?: string;
  paymentStatus?: string;
  raw?: unknown;
};

export type CheckoutUnpaidResult = { kind: "released" } | { kind: "rejected"; reason: string };

// Online orders store a handful of lines; more than this is not a valid snapshot.
const storedLineReadLimit = 100;
// One order creates one Session per attempt; more is unverifiable history.
const creationReadLimit = 50;

/** Fields that must stay identical when a paid notification repeats. */
const immutableBookingFields = ["bookingRef", "orderRef", "visitDate", "entryTime", "partySize", "emailLower"] as const;

export async function patchCheckoutAttempt(
  ctx: MutationCtx,
  attempt: AttemptDoc,
  fields: Partial<Omit<AttemptDoc, "_id" | "_creationTime">>,
  now: number
) {
  await ctx.db.patch(attempt._id, { ...fields, version: attempt.version + 1, updatedAt: now });
}

/** Replaces the customer email in a settled, unpaid attempt's frozen request. */
export function redactedRequestParams(params: AttemptDoc["requestParams"]) {
  return params.map((param) => (param.name === "customer_email" ? { name: param.name, value: "[redacted]" } : param));
}

/**
 * Finds the Convex attempt behind a Stripe Session: by stored Session id, or
 * by order + attempt nonce when the creation response was lost. A pre-attempt
 * order is correlated by its stored `created` payment event, as before.
 */
export async function correlateCheckoutSession(
  ctx: MutationCtx,
  args: { orderRef: string; providerSessionId: string; attemptNonce?: string }
) {
  let attempt: AttemptDoc | undefined =
    (await ctx.db
      .query("checkoutPaymentAttempts")
      .withIndex("by_providerSessionId", (q) => q.eq("providerSessionId", args.providerSessionId))
      .first()) ?? undefined;
  let conflict: string | undefined;
  let sessionLearned = false;
  if (attempt && attempt.orderRef !== args.orderRef) {
    conflict = "session_order_mismatch";
  }
  if (!attempt && args.attemptNonce) {
    const forOrder =
      (await ctx.db
        .query("checkoutPaymentAttempts")
        .withIndex("by_orderRef", (q) => q.eq("orderRef", args.orderRef))
        .first()) ?? undefined;
    if (forOrder && forOrder.attemptNonce === args.attemptNonce) {
      if (forOrder.providerSessionId && forOrder.providerSessionId !== args.providerSessionId) {
        conflict = "attempt_session_mismatch";
      } else {
        attempt = forOrder;
        sessionLearned = !forOrder.providerSessionId;
      }
    }
  }
  if (attempt && !attempt.legacy && !conflict && args.attemptNonce !== attempt.attemptNonce) {
    conflict = args.attemptNonce === undefined ? "attempt_nonce_missing" : "attempt_nonce_mismatch";
  }

  // The order's own `created` subset: payment history for the Session can
  // never push its creation record out of a bounded read.
  const created = await ctx.db
    .query("paymentEvents")
    .withIndex("by_orderRef_status", (q) => q.eq("orderRef", args.orderRef).eq("status", "created"))
    .take(creationReadLimit + 1);
  const creationEvent = created.find(
    (event) => event.provider === "stripe" && event.providerPaymentId === args.providerSessionId
  );
  if (!conflict && !creationEvent && created.length > creationReadLimit) conflict = "session_creation_unverified";
  return { attempt, creationEvent, conflict, sessionLearned };
}

async function recordLearnedSession(
  ctx: MutationCtx,
  attempt: AttemptDoc,
  creationEventExists: boolean,
  providerSessionId: string,
  now: number
) {
  await patchCheckoutAttempt(ctx, attempt, { providerSessionId }, now);
  if (!creationEventExists) {
    await ctx.db.insert("paymentEvents", {
      orderRef: attempt.orderRef,
      provider: "stripe",
      providerPaymentId: providerSessionId,
      idempotencyKey: attempt.providerIdempotencyKey,
      status: "created",
      currency: attempt.currency,
      amountCents: attempt.amountCents,
      raw: { learnedFrom: "signed_session_correlation" },
      createdAt: now
    });
  }
  return { ...attempt, providerSessionId, version: attempt.version + 1 };
}

/** True when the LA instant falls before the entitlement window ends. */
export function instantBeforeVisitWindowEnd(timestamp: number, visitDate: string, endMinutes: number) {
  const clock = venueClock(timestamp);
  return clock.date < visitDate || (clock.date === visitDate && clock.minutes < endMinutes);
}

/**
 * Records a paid Checkout Session exactly once and fulfills it when the order
 * can still be honored. Paid money is never rolled back or recorded as a
 * failure: anything that blocks a ticket (mismatch, lateness, capacity, a
 * closed or invalid order) becomes an audited billing exception with no ticket
 * and no customer message. Capacity held for paid money is never released.
 */
export async function settleCheckoutPaid(
  ctx: MutationCtx,
  evidence: CheckoutPaidEvidence,
  now: number
): Promise<CheckoutPaidResult> {
  const orders = await ctx.db
    .query("orders")
    .withIndex("by_orderRef", (q) => q.eq("orderRef", evidence.orderRef))
    .take(2);
  const order = orders.length === 1 ? orders[0] : null;
  const correlation = await correlateCheckoutSession(ctx, evidence);
  let attempt =
    correlation.attempt && correlation.attempt.orderRef === evidence.orderRef ? correlation.attempt : undefined;

  const raise = async (
    code: string,
    moneyRecorded: boolean,
    extra: Record<string, string | number | boolean | undefined> = {}
  ): Promise<CheckoutPaidResult> => {
    await openOperationsException(ctx, {
      category: "billing",
      code,
      dedupeKey: `billing:${code}:${evidence.orderRef}:${evidence.providerPaymentIntentId ?? evidence.providerSessionId}`,
      moneyReceived: true,
      orderRef: evidence.orderRef,
      providerSessionId: evidence.providerSessionId,
      providerPaymentIntentId: evidence.providerPaymentIntentId,
      providerEventId: evidence.providerEventId,
      amountCents: evidence.amountCents,
      currency: evidence.currency,
      evidence: {
        source: evidence.source,
        eventType: evidence.eventType,
        sessionMode: evidence.sessionMode,
        livemode: evidence.livemode,
        paidAt: evidence.paidAt,
        moneyRecorded,
        ...extra
      },
      now
    });
    if (attempt) {
      await patchCheckoutAttempt(ctx, attempt, {
        status: moneyRecorded ? "paid" : "exception",
        exceptionReason: code,
        providerPaymentIntentId: evidence.providerPaymentIntentId ?? attempt.providerPaymentIntentId,
        reconcileAt: undefined,
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        settledAt: now
      }, now);
    }
    return { kind: "exception", code, moneyRecorded };
  };

  if (orders.length > 1) return raise("order_duplicate", false);
  if (!order || order.channel !== "online") return raise("order_not_found", false);
  if (correlation.conflict) return raise(correlation.conflict, false);
  if (!attempt && !correlation.creationEvent) return raise("payment_session_not_created_by_convex", false);
  const modern = attempt && !attempt.legacy;
  if ((modern || evidence.sessionMode !== undefined) && evidence.sessionMode !== "payment") {
    return raise("paid_session_mode_invalid", false);
  }
  if (attempt && (modern || evidence.livemode !== undefined) && evidence.livemode !== (attempt.stripeMode === "live")) {
    return raise("paid_session_livemode_mismatch", false);
  }
  if (modern && (evidence.sessionStatus !== "complete" || evidence.paymentStatus !== "paid")) {
    return raise("paid_session_facts_invalid", false);
  }
  const expectedAmount = attempt?.amountCents ?? correlation.creationEvent!.amountCents;
  const expectedCurrency = attempt?.currency ?? correlation.creationEvent!.currency;
  if (
    evidence.amountCents === undefined ||
    evidence.currency === undefined ||
    evidence.amountCents !== expectedAmount ||
    evidence.currency !== expectedCurrency ||
    evidence.amountCents !== order.totalCents ||
    evidence.currency !== order.currency
  ) {
    return raise("amount_or_currency_mismatch", false);
  }
  if (order.expectedProvider !== "stripe") return raise("order_expected_provider_mismatch", false);
  if (!evidence.providerPaymentIntentId) return raise("missing_checkout_payment_intent", false);

  // One PaymentIntent can pay for exactly one checkout order or POS sale.
  // Every ledger row of the intent, pending or settled, must be this order's
  // own Stripe row for this Session; a visible foreign owner (a Terminal
  // sale or another order) keeps its record and blocks reuse.
  const ownsOrderRow = (event: Doc<"paymentEvents">) =>
    event.provider === "stripe" && event.orderRef === evidence.orderRef && event.saleRef === undefined;
  const ownership = await checkIntentOwnership(
    ctx,
    evidence.providerPaymentIntentId,
    (event) => ownsOrderRow(event) && event.providerPaymentId === evidence.providerSessionId
  );
  // Reuse records no money here (the real owner keeps its record), but this
  // correlated order's single hold stays counted instead of becoming releasable.
  const reused = async () => {
    if (order.status === "payment_pending") {
      await holdPaidExceptionCapacity(ctx, { orderRef: evidence.orderRef }, "paid_unfulfilled:paid_payment_identity_reused", now);
    }
    return raise("paid_payment_identity_reused", true);
  };
  if (ownership.kind === "conflict") return reused();

  // The current payment's paid record, by intent id and by exact Session id
  // (take 2 each), independent of the order's history. The Session read also
  // finds a legacy paid row that never stored the intent id. Another owner's
  // record of the same real payment is kept as it is, never copied.
  const [byIntent, bySession] = await Promise.all([
    paidIdentityForIntent(ctx, evidence.providerPaymentIntentId),
    paidIdentityForProviderPayment(ctx, "stripe", evidence.providerSessionId)
  ]);
  const intentRows = identityRows(byIntent);
  const sessionRows = identityRows(bySession);
  if ([...intentRows, ...sessionRows].some((event) => !ownsOrderRow(event))) return reused();

  if (attempt && correlation.sessionLearned) {
    attempt = await recordLearnedSession(ctx, attempt, Boolean(correlation.creationEvent), evidence.providerSessionId, now);
  }

  // Money ledger: one paid event per PaymentIntent, whatever the event id.
  // The order's paid history is bounded; an overflow never proves no other
  // payment and never hides the current one, which the identity reads found.
  const ownerPaid = await paidSummaryForOrder(ctx, evidence.orderRef);
  const samePayment = intentRows[0] ?? sessionRows[0];
  const otherPaid =
    ownerPaid.overflow ||
    ownerPaid.rows.some(
      (event) => event.providerPaymentIntentId !== evidence.providerPaymentIntentId && event.providerPaymentId !== evidence.providerSessionId
    );
  if (!samePayment) {
    await ctx.db.insert("paymentEvents", {
      orderRef: evidence.orderRef,
      provider: "stripe",
      providerPaymentId: evidence.providerSessionId,
      providerPaymentIntentId: evidence.providerPaymentIntentId,
      idempotencyKey: attempt?.providerIdempotencyKey ?? correlation.creationEvent?.idempotencyKey,
      status: "paid",
      currency: evidence.currency,
      amountCents: evidence.amountCents,
      rawEventId: evidence.providerEventId ?? `reconciliation:${evidence.providerSessionId}`,
      raw: evidence.raw,
      createdAt: now
    });
  }

  // The current money is now recorded exactly once. What cannot be proven
  // stays a visible exception with its places held; an order already closed
  // (for example by a refund) is never reopened.
  const retain = (code: string) =>
    order.status === "payment_pending" ? blockPaidFulfillment(code, {}) : raise(code, true);
  // Correlated to this order's Session, but the intent's other rows exceed
  // the bound: money kept exactly once, ownership left for staff.
  if (ownership.kind === "unverified") return retain("paid_payment_identity_unverified");
  if (byIntent.kind === "duplicate" || bySession.kind === "duplicate") return retain("paid_payment_ledger_duplicate");
  if (samePayment) {
    const facts = {
      providerPaymentId: evidence.providerSessionId,
      providerPaymentIntentId: evidence.providerPaymentIntentId,
      amountCents: evidence.amountCents,
      currency: evidence.currency
    };
    // A Session paid under another intent, or a legacy row without one, is
    // kept as stored (never rewritten or backfilled); the current facts
    // become the exception.
    if (samePayment.providerPaymentIntentId !== facts.providerPaymentIntentId ||
        samePayment.providerPaymentId !== facts.providerPaymentId ||
        intentRows[0]?._id !== sessionRows[0]?._id) {
      return retain("paid_payment_identity_conflict");
    }
    if (!samePaidRecord(intentRows[0], sessionRows[0], facts)) return retain("paid_payment_record_mismatch");
  }
  // A second, distinct payment for one order: record the money, keep the
  // single booking, and let staff decide on a refund.
  if (!samePayment && otherPaid) return retain("duplicate_payment_for_order");

  const markAttemptPaid = async () => {
    if (attempt && attempt.status !== "paid") {
      await patchCheckoutAttempt(ctx, attempt, {
        status: "paid",
        providerPaymentIntentId: evidence.providerPaymentIntentId,
        reconcileAt: undefined,
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        settledAt: now
      }, now);
    }
  };

  if (order.status === "paid") {
    const bookings = await orderBookings(ctx, evidence.orderRef);
    await markAttemptPaid();
    if (bookings.length > 1) return raise("paid_booking_duplicate", true);
    // Paid earlier but blocked, or a later exception: keep the original
    // exception; a repeat never queues a ticket or re-fulfills.
    const open = await openBillingExceptionsForOrder(ctx, evidence.orderRef);
    if (open.length > 0) return { kind: "exception", code: open[0].code, moneyRecorded: true };
    // Another distinct paid record, or a paid history too long to read: the
    // current money stays recorded, but nothing is re-delivered.
    if (otherPaid) return raise("paid_owner_payment_ambiguous", true);
    const booking = bookings[0];
    if (booking) {
      // Repeated notification for a fulfilled order: reuse the one booking and
      // its delivery; only a missing delivery for a confirmed booking is queued.
      if (booking.status === "confirmed") {
        // The same canonical proof the door and ticket view use, before any
        // delivery is queued; only classified proof failures are caught.
        const proof = await bookingPaidProof(ctx, booking);
        if (!proof.ok) return raise("paid_booking_proof_invalid", true, { proofReason: proof.reason });
        try {
          await assertTicketDeliveryReady(ctx, {
            ticketCode: evidence.ticketCode, bookingRef: booking.bookingRef,
            orderRef: evidence.orderRef, emailLower: booking.emailLower, now
          });
        } catch {
          return raise("paid_ticket_delivery_invalid", true);
        }
        await ensureTicketDelivery(ctx, {
          ticketCode: evidence.ticketCode,
          bookingRef: booking.bookingRef,
          orderRef: evidence.orderRef,
          emailLower: booking.emailLower,
          now
        });
      }
      return { kind: "fulfilled", bookingRef: booking.bookingRef, repeated: true };
    }
    return raise("paid_order_without_booking", true);
  }

  if (order.status !== "payment_pending") {
    if (samePayment) {
      // Already recorded (for example a refund closed the order); a repeat
      // notification must not reopen or re-fulfill it.
      return { kind: "ignored", reason: "order_status_not_payable" };
    }
    return blockPaidFulfillment(
      order.status === "draft" ? "paid_order_state_unexpected" : "paid_after_order_closed",
      { orderStatus: order.status }
    );
  }
  if (ownerPaid.overflow) return blockPaidFulfillment("paid_owner_history_unverified", {});

  const lines = await ctx.db
    .query("orderLineItems")
    .withIndex("by_orderRef", (q) => q.eq("orderRef", evidence.orderRef))
    .take(storedLineReadLimit + 1);
  let fulfillment: ReturnType<typeof buildConfirmedCheckoutFulfillment>;
  try {
    if (lines.length > storedLineReadLimit) throw new Error("too many stored lines");
    assertStoredPaymentLineProvenance(lines, "Checkout webhook");
    fulfillment = buildConfirmedCheckoutFulfillment(order, lines, now);
  } catch (error) {
    return blockPaidFulfillment("paid_order_snapshot_invalid", {
      detail: (error instanceof Error ? error.message : "invalid snapshot").slice(0, 200)
    });
  }

  // Valid from purchase until the closing of the entered segment on the
  // selected LA date. Neither the signed payment time nor this processing
  // time may fall after it; no admission moves to another day.
  const booking = fulfillment.booking;
  // Known ledger corruption is classified, never thrown, so it cannot roll
  // back the paid row above; the order's places stay held.
  const reservationLookup = await lookupCapacityReservation(ctx, evidence.orderRef);
  if (reservationLookup.kind === "inconsistent") {
    return blockPaidFulfillment("paid_capacity_reservation_inconsistent", { integrity: reservationLookup.code });
  }
  const reservation = reservationLookup.reservation;
  const existingBookings = await orderBookings(ctx, evidence.orderRef);
  if (existingBookings.length > 1) return blockPaidFulfillment("paid_booking_duplicate", {});
  let hours: Awaited<ReturnType<typeof loadVenueHours>>;
  try {
    hours = await loadVenueHours(ctx);
  } catch (error) {
    // Untrusted stored hours never authorize a ticket; the exception path
    // below does not read hours again.
    if (!(error instanceof VenueHoursIntegrityError)) throw error;
    return blockPaidFulfillment("paid_venue_hours_unverified", { integrity: error.code });
  }
  const windowEnd =
    reservation && reservation.visitDate === booking.visitDate && reservation.entryTime === booking.entryTime
      ? reservation.endMinutes
      : visitEntitlementWindow(hours, booking.visitDate, booking.entryTime)?.endMinutes ?? venueDayMinutes;
  const paidAt = evidence.paidAt ?? now;
  if (!instantBeforeVisitWindowEnd(paidAt, booking.visitDate, windowEnd)) {
    return blockPaidFulfillment("paid_after_visit_window", { paidAt, windowEndMinutes: windowEnd });
  }
  if (!instantBeforeVisitWindowEnd(now, booking.visitDate, windowEnd)) {
    return blockPaidFulfillment("paid_fulfillment_after_visit_window", { paidAt, windowEndMinutes: windowEnd });
  }

  const existingBooking = existingBookings[0];
  if (existingBooking && bookingMismatch(existingBooking, booking)) {
    return blockPaidFulfillment("paid_booking_mismatch", { field: bookingMismatch(existingBooking, booking) });
  }
  if (reservation && reservationMismatch(reservation, booking)) {
    return blockPaidFulfillment("paid_capacity_reservation_mismatch", {});
  }
  try {
    await assertTicketDeliveryReady(ctx, {
      ticketCode: evidence.ticketCode, bookingRef: booking.bookingRef,
      orderRef: evidence.orderRef, emailLower: booking.emailLower, now
    });
  } catch {
    return blockPaidFulfillment("paid_ticket_delivery_invalid", {});
  }
  // The hold becomes paid in this same transaction as the booking. An order
  // with no usable hold either reserves now or becomes a counted exception.
  const capacity = await settlePaidCapacity(ctx, {
    orderRef: evidence.orderRef,
    bookingRef: booking.bookingRef,
    visitDate: booking.visitDate,
    entryTime: booking.entryTime,
    partySize: booking.partySize,
    alreadyCommitted: Boolean(existingBooking),
    hours,
    now
  });
  if (capacity.kind === "exception") {
    await ctx.db.insert("auditEvents", {
      action: "checkout.capacityException",
      entityType: "order",
      entityRef: evidence.orderRef,
      metadata: {
        reason: capacity.reason,
        visitDate: booking.visitDate,
        entryTime: booking.entryTime,
        partySize: booking.partySize,
        providerPaymentId: evidence.providerSessionId,
        providerPaymentIntentId: evidence.providerPaymentIntentId,
        amountCents: evidence.amountCents
      },
      createdAt: now
    });
    return blockPaidFulfillment("paid_order_capacity_exception", { capacityReason: capacity.reason });
  }

  if (!existingBooking) {
    await ctx.db.insert("bookings", booking);
    await ctx.db.insert("auditEvents", {
      action: "checkout.bookingFulfilled",
      entityType: "booking",
      entityRef: booking.bookingRef,
      metadata: fulfillment.auditMetadata,
      createdAt: now
    });
  }
  await ensureTicketDelivery(ctx, {
    ticketCode: evidence.ticketCode,
    bookingRef: booking.bookingRef,
    orderRef: evidence.orderRef,
    emailLower: booking.emailLower,
    now
  });
  await ctx.db.patch(order._id, { status: "paid", expectedProvider: "stripe", updatedAt: now });
  await markAttemptPaid();
  return { kind: "fulfilled", bookingRef: booking.bookingRef, repeated: false };

  async function blockPaidFulfillment(
    code: string,
    extra: Record<string, string | number | boolean | undefined>
  ): Promise<CheckoutPaidResult> {
    // The money is real: the order is paid, the places stay counted, and no
    // ticket or confirmation is issued until staff resolve the exception.
    await ctx.db.patch((order as OrderDoc)._id, { status: "paid", expectedProvider: "stripe", updatedAt: now });
    // The order's single hold becomes a counted exception; ambiguous holds
    // are left as stored (still counted, never released).
    await holdPaidExceptionCapacity(ctx, { orderRef: evidence.orderRef }, `paid_unfulfilled:${code}`, now);
    return raise(code, true, extra);
  }
}

/**
 * Applies a correlated unpaid outcome (Session expired or async payment
 * failed). It releases an unpaid hold only when the order is still
 * payment_pending; paid or exception holds are never reopened.
 */
export async function settleCheckoutUnpaid(
  ctx: MutationCtx,
  evidence: CheckoutUnpaidEvidence,
  now: number
): Promise<CheckoutUnpaidResult> {
  const order = await ctx.db
    .query("orders")
    .withIndex("by_orderRef", (q) => q.eq("orderRef", evidence.orderRef))
    .unique();
  if (!order) return { kind: "rejected", reason: "order_not_found" };
  const correlation = await correlateCheckoutSession(ctx, evidence);
  if (correlation.conflict) return { kind: "rejected", reason: correlation.conflict };
  let attempt = correlation.attempt;
  if (!attempt && !correlation.creationEvent) {
    return { kind: "rejected", reason: "payment_session_not_created_by_convex" };
  }
  if (attempt && !attempt.legacy && (
    evidence.sessionMode !== "payment" || evidence.livemode !== (attempt.stripeMode === "live") ||
    evidence.paymentStatus !== "unpaid" ||
    (evidence.outcome === "canceled" ? evidence.sessionStatus !== "expired" : evidence.sessionStatus !== "complete")
  )) return { kind: "rejected", reason: "unpaid_session_facts_invalid" };

  const expectedAmount = attempt?.amountCents ?? correlation.creationEvent!.amountCents;
  const expectedCurrency = attempt?.currency ?? correlation.creationEvent!.currency;
  const amountCents = evidence.amountCents ?? expectedAmount;
  const currency = evidence.currency ?? expectedCurrency;
  if (
    order.totalCents !== amountCents ||
    order.currency !== currency ||
    expectedAmount !== amountCents ||
    expectedCurrency !== currency
  ) {
    return { kind: "rejected", reason: "amount_or_currency_mismatch" };
  }
  if (evidence.paymentStatus !== undefined && evidence.paymentStatus !== "unpaid") {
    return { kind: "rejected", reason: "unpaid_outcome_payment_status_mismatch" };
  }
  if (evidence.outcome === "canceled" && evidence.sessionStatus !== undefined && evidence.sessionStatus !== "expired") {
    return { kind: "rejected", reason: "unpaid_outcome_session_status_mismatch" };
  }
  if (order.expectedProvider !== "stripe") return { kind: "rejected", reason: "order_expected_provider_mismatch" };
  if (order.status === "paid" || attempt?.status === "paid") return { kind: "rejected", reason: "order_already_paid" };
  if (order.status !== "payment_pending") return { kind: "rejected", reason: "order_status_not_payable" };

  if (attempt && correlation.sessionLearned) {
    attempt = await recordLearnedSession(ctx, attempt, Boolean(correlation.creationEvent), evidence.providerSessionId, now);
  }
  await ctx.db.insert("paymentEvents", {
    orderRef: evidence.orderRef,
    provider: "stripe",
    providerPaymentId: evidence.providerSessionId,
    idempotencyKey: attempt?.providerIdempotencyKey ?? correlation.creationEvent?.idempotencyKey,
    status: evidence.outcome === "failed" ? "failed" : "canceled",
    currency,
    amountCents,
    rawEventId: evidence.providerEventId ?? `reconciliation:${evidence.providerSessionId}`,
    raw: evidence.raw,
    createdAt: now
  });
  await ctx.db.patch(order._id, {
    status: stripeCheckoutOrderStatusAfterUnpaidOutcome(evidence.outcome),
    expectedProvider: "stripe",
    updatedAt: now
  });
  // Signed (or provider-read) and correlated to the Convex-created Session;
  // paid and exception holds are never reopened by a stale unpaid outcome.
  await releaseUnpaidCapacityHold(
    ctx,
    evidence.orderRef,
    evidence.source === "webhook" ? `stripe:${evidence.eventType}` : "stripe:session_expired_reconciled",
    now
  );
  if (attempt) {
    await patchCheckoutAttempt(ctx, attempt, {
      status: "expired",
      requestParams: redactedRequestParams(attempt.requestParams),
      reconcileAt: undefined,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      lastProviderState: evidence.outcome === "failed" ? "async_payment_failed" : "expired",
      settledAt: now
    }, now);
  }
  return { kind: "released" };
}

/** Bookings for an order; more than one is a corrupt ledger the caller reports. */
async function orderBookings(ctx: MutationCtx, orderRef: string) {
  return ctx.db
    .query("bookings")
    .withIndex("by_orderRef", (q) => q.eq("orderRef", orderRef))
    .take(2);
}

function bookingMismatch(
  existing: Pick<Doc<"bookings">, "bookingRef" | "orderRef" | "visitDate" | "entryTime" | "partySize" | "emailLower">,
  expected: ConfirmedCheckoutBooking
) {
  return immutableBookingFields.find((field) => existing[field] !== expected[field]);
}

function reservationMismatch(
  reservation: Pick<Doc<"capacityReservations">, "visitDate" | "entryTime" | "partySize">,
  booking: ConfirmedCheckoutBooking
) {
  return (
    reservation.visitDate !== booking.visitDate ||
    reservation.entryTime !== booking.entryTime ||
    reservation.partySize !== booking.partySize
  );
}
