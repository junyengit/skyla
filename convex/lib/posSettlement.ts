import { venueDayMinutes, visitEntitlementWindow, visitTimeMinutes } from "@skyla/payments";

import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { bookingPaidProof } from "./admission";
import {
  decideCapacity,
  holdPaidExceptionCapacity,
  loadDateOccupancy,
  loadVenueHours,
  lookupCapacityReservation,
  releaseUnpaidCapacityHold,
  VenueHoursIntegrityError
} from "./capacity";
import { instantBeforeVisitWindowEnd } from "./checkoutSettlement";
import { openBillingExceptionsForSale, openOperationsException } from "./operationsExceptions";
import { assertStoredPaymentLineProvenance, posStoredLineLimit } from "./orderDraftPersistence";
import {
  checkIntentOwnership,
  hasPaidEventForIntent,
  hasPaidEventForSale,
  identityRows,
  paidIdentityForIntent,
  paidIdentityForProviderPayment,
  paidSummaryForSale,
  samePaidRecord
} from "./paymentEvidence";
import { buildConfirmedPosFulfillment, posTicketPartySize, type ConfirmedPosBooking } from "./posFulfillment";
import { stripeTerminalIntentIdempotencyKey, terminalIntentSource } from "./stripeTerminal";
import { assertTicketDeliveryReady, ensureTicketDelivery } from "./ticketDeliveryQueue";

type AttemptDoc = Doc<"terminalPaymentAttempts">;
type SaleDoc = Doc<"posSales">;
type Scalar = string | number | boolean | undefined;

export type TerminalIntentFacts = {
  source: "webhook" | "reconciliation";
  providerEventId?: string;
  eventType: string;
  providerPaymentIntentId: string;
  saleRef: string;
  attemptNonce?: string;
  /** PaymentIntent metadata.source. */
  intentSource?: string;
  amountCents?: number;
  amountReceivedCents?: number;
  currency?: "usd";
  livemode?: boolean;
  intentStatus?: string;
  /** Signed provider time of the event; processing time when unknown. */
  paidAt?: number;
  ticketCode?: string;
  raw?: unknown;
};

export type TerminalPaidResult =
  | { kind: "fulfilled"; bookingRef?: string; repeated: boolean }
  | { kind: "exception"; code: string; moneyRecorded: boolean }
  | { kind: "ignored"; reason: string };

export type TerminalUnpaidResult = { kind: "recorded" } | { kind: "rejected"; reason: string };

/** Fields that must stay identical when a paid notification repeats. */
const immutableBookingFields = ["bookingRef", "saleRef", "visitDate", "entryTime", "partySize", "emailLower"] as const;

export async function patchTerminalAttempt(
  ctx: MutationCtx,
  attempt: AttemptDoc,
  fields: Partial<Omit<AttemptDoc, "_id" | "_creationTime">>,
  now: number
) {
  await ctx.db.patch(attempt._id, { ...fields, version: attempt.version + 1, updatedAt: now });
}

/**
 * Finds the Convex attempt behind a Terminal PaymentIntent: by stored intent
 * id, or by sale + attempt nonce when the creation response was lost. A sale
 * created before frozen attempts is correlated only by its stored
 * `requires_payment` ledger row and old idempotency key.
 */
export async function correlateTerminalIntent(
  ctx: MutationCtx,
  args: { saleRef: string; providerPaymentIntentId: string; attemptNonce?: string }
) {
  const byIntent = await ctx.db
    .query("terminalPaymentAttempts")
    .withIndex("by_providerPaymentIntentId", (q) => q.eq("providerPaymentIntentId", args.providerPaymentIntentId))
    .take(2);
  const forSale = await ctx.db
    .query("terminalPaymentAttempts")
    .withIndex("by_saleRef", (q) => q.eq("saleRef", args.saleRef))
    .first();
  let attempt: AttemptDoc | undefined;
  let conflict: string | undefined;
  let intentLearned = false;

  if (byIntent.length > 1 || byIntent.some((row) => row.saleRef !== args.saleRef)) {
    conflict = "intent_sale_mismatch";
  } else if (byIntent[0]) {
    attempt = byIntent[0];
  } else if (forSale) {
    if (forSale.providerPaymentIntentId && forSale.providerPaymentIntentId !== args.providerPaymentIntentId) {
      conflict = "attempt_intent_mismatch";
    } else if (args.attemptNonce === forSale.attemptNonce) {
      attempt = forSale;
      intentLearned = true;
    }
  }
  if (!conflict && forSale && !attempt) {
    // A modern sale's intent always carries its attempt nonce.
    conflict = args.attemptNonce === undefined ? "attempt_nonce_missing" : "attempt_nonce_mismatch";
  }
  if (!conflict && attempt && args.attemptNonce !== attempt.attemptNonce) {
    conflict = args.attemptNonce === undefined ? "attempt_nonce_missing" : "attempt_nonce_mismatch";
  }

  const legacyEvent = forSale
    ? undefined
    : (
        await ctx.db
          .query("paymentEvents")
          .withIndex("by_provider_providerPaymentId", (q) =>
            q.eq("provider", "terminal").eq("providerPaymentId", args.providerPaymentIntentId)
          )
          .take(20)
      ).find(
        (event) =>
          event.saleRef === args.saleRef &&
          event.status !== "paid" &&
          event.idempotencyKey === stripeTerminalIntentIdempotencyKey(args.saleRef)
      );
  return { attempt, legacyEvent, conflict, intentLearned };
}

async function learnIntent(ctx: MutationCtx, attempt: AttemptDoc, providerPaymentIntentId: string, now: number) {
  await patchTerminalAttempt(ctx, attempt, { providerPaymentIntentId, status: attempt.status === "creating" || attempt.status === "creation_unknown" ? "open" : attempt.status }, now);
  await ensureIntentLedgerRow(ctx, attempt, providerPaymentIntentId, now, { learnedFrom: "signed_intent_correlation" });
  return { ...attempt, providerPaymentIntentId, version: attempt.version + 1 };
}

/** The `requires_payment` ledger row other staff reads and refunds expect. */
export async function ensureIntentLedgerRow(
  ctx: MutationCtx,
  attempt: Pick<AttemptDoc, "saleRef" | "providerIdempotencyKey" | "amountCents" | "currency">,
  providerPaymentIntentId: string,
  now: number,
  raw?: unknown
) {
  const rows = await ctx.db
    .query("paymentEvents")
    .withIndex("by_provider_providerPaymentId", (q) =>
      q.eq("provider", "terminal").eq("providerPaymentId", providerPaymentIntentId)
    )
    .take(20);
  if (rows.some((row) => row.saleRef === attempt.saleRef && row.status === "requires_payment")) return;
  await ctx.db.insert("paymentEvents", {
    saleRef: attempt.saleRef,
    provider: "terminal",
    providerPaymentId: providerPaymentIntentId,
    providerPaymentIntentId,
    idempotencyKey: attempt.providerIdempotencyKey,
    status: "requires_payment",
    currency: attempt.currency,
    amountCents: attempt.amountCents,
    raw,
    createdAt: now
  });
}

function saleTotalsValid(sale: SaleDoc, lines: Array<{ lineTotalCents: number }>) {
  return (
    sale.currency === "usd" &&
    sale.feeCents === 0 &&
    Number.isSafeInteger(sale.totalCents) &&
    sale.totalCents > 0 &&
    sale.subtotalCents === sale.totalCents &&
    lines.reduce((sum, line) => sum + line.lineTotalCents, 0) === sale.subtotalCents
  );
}

/**
 * Records a paid Terminal PaymentIntent exactly once and fulfills it when the
 * sale can still be honored. The paid ledger row is written before any
 * booking or delivery work, and every later problem is preflighted, so
 * nothing fallible can roll the money back. Anything that blocks a ticket
 * (mismatch, lateness, a closed or invalid sale, capacity or a private event)
 * becomes an audited billing exception with no ticket and no message. Held
 * places are never released for paid money.
 */
export async function settlePosPaid(ctx: MutationCtx, evidence: TerminalIntentFacts, now: number): Promise<TerminalPaidResult> {
  const sales = await ctx.db
    .query("posSales")
    .withIndex("by_saleRef", (q) => q.eq("saleRef", evidence.saleRef))
    .take(2);
  const sale = sales.length === 1 ? sales[0] : null;
  const correlation = await correlateTerminalIntent(ctx, evidence);
  let attempt = correlation.attempt;

  const raise = async (code: string, moneyRecorded: boolean, extra: Record<string, Scalar> = {}): Promise<TerminalPaidResult> => {
    await openOperationsException(ctx, {
      category: "billing",
      code,
      dedupeKey: `billing:${code}:sale:${evidence.saleRef}:${evidence.providerPaymentIntentId}`,
      moneyReceived: true,
      saleRef: evidence.saleRef,
      providerPaymentIntentId: evidence.providerPaymentIntentId,
      providerEventId: evidence.providerEventId,
      amountCents: evidence.amountCents,
      currency: evidence.currency,
      evidence: {
        source: evidence.source,
        eventType: evidence.eventType,
        livemode: evidence.livemode,
        intentStatus: evidence.intentStatus,
        paidAt: evidence.paidAt,
        moneyRecorded,
        ...extra
      },
      now
    });
    if (attempt) {
      const current = (await ctx.db.get(attempt._id))!;
      await patchTerminalAttempt(ctx, current, {
        status: moneyRecorded ? "paid" : "exception",
        exceptionReason: code,
        reconcileAt: undefined,
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        settledAt: now
      }, now);
    }
    return { kind: "exception", code, moneyRecorded };
  };

  if (sales.length > 1) return raise("pos_sale_duplicate", false);
  if (!sale) return raise("pos_sale_not_found", false);
  if (correlation.conflict) return raise(correlation.conflict, false);
  if (!attempt && !correlation.legacyEvent) return raise("terminal_intent_not_created_by_convex", false);
  const modern = Boolean(attempt);
  if ((modern || evidence.intentSource !== undefined) && evidence.intentSource !== terminalIntentSource) {
    return raise("paid_intent_source_invalid", false);
  }
  if (attempt && evidence.livemode !== (attempt.stripeMode === "live")) {
    return raise("paid_intent_livemode_mismatch", false);
  }
  if ((modern || evidence.intentStatus !== undefined) && evidence.intentStatus !== "succeeded") {
    return raise("paid_intent_facts_invalid", false);
  }
  if ((modern || evidence.amountReceivedCents !== undefined) && evidence.amountReceivedCents !== evidence.amountCents) {
    return raise("paid_intent_amount_received_mismatch", false);
  }
  const expectedAmount = attempt?.amountCents ?? correlation.legacyEvent!.amountCents;
  const expectedCurrency = attempt?.currency ?? correlation.legacyEvent!.currency;
  if (
    evidence.amountCents === undefined ||
    evidence.currency === undefined ||
    evidence.amountCents !== expectedAmount ||
    evidence.currency !== expectedCurrency ||
    evidence.amountCents !== sale.totalCents ||
    evidence.currency !== sale.currency
  ) {
    return raise("amount_or_currency_mismatch", false);
  }

  // One PaymentIntent can pay for exactly one checkout order or POS sale.
  // Every status, pending ones included, is checked through its own index
  // range. A visible foreign owner keeps its own money record and this one
  // stays a visible exception; an unprovable owner is never inferred from a
  // prefix (see below).
  const ownsRow = (row: Doc<"paymentEvents">) =>
    row.orderRef === undefined && row.saleRef === evidence.saleRef && row.provider === "terminal";
  // Reuse records no money here (the real owner keeps its record), but this
  // correlated sale's single hold stays counted instead of becoming releasable.
  const reused = async () => {
    if (sale.status === "payment_pending") {
      await holdPaidExceptionCapacity(ctx, { saleRef: evidence.saleRef }, "paid_unfulfilled:paid_payment_identity_reused", now);
    }
    return raise("paid_payment_identity_reused", false);
  };
  const ownership = await checkIntentOwnership(ctx, evidence.providerPaymentIntentId, ownsRow);
  if (ownership.kind === "conflict") return reused();

  if (attempt && correlation.intentLearned) {
    attempt = await learnIntent(ctx, attempt, evidence.providerPaymentIntentId, now);
  }

  // Money ledger first: exactly one paid row per PaymentIntent, found by its
  // intent id and by its exact provider payment id (take 2 each), whatever
  // the event id or the sale's paid history. The provider read also finds a
  // legacy paid row that never stored the intent id.
  const [byIntent, byProviderId] = await Promise.all([
    paidIdentityForIntent(ctx, evidence.providerPaymentIntentId),
    paidIdentityForProviderPayment(ctx, "terminal", evidence.providerPaymentIntentId)
  ]);
  const intentRows = identityRows(byIntent);
  const providerRows = identityRows(byProviderId);
  if ([...intentRows, ...providerRows].some((row) => !ownsRow(row))) return reused();
  const samePayment = intentRows[0] ?? providerRows[0];
  const ownerPaid = await paidSummaryForSale(ctx, evidence.saleRef);
  // An overflowing history always holds another payment: it never proves none.
  const otherPaid =
    ownerPaid.overflow ||
    ownerPaid.rows.some(
      (row) => row.providerPaymentIntentId !== evidence.providerPaymentIntentId && row.providerPaymentId !== evidence.providerPaymentIntentId
    );
  if (!samePayment) {
    await ctx.db.insert("paymentEvents", {
      saleRef: evidence.saleRef,
      provider: "terminal",
      providerPaymentId: evidence.providerPaymentIntentId,
      providerPaymentIntentId: evidence.providerPaymentIntentId,
      idempotencyKey: attempt?.providerIdempotencyKey ?? correlation.legacyEvent?.idempotencyKey,
      status: "paid",
      currency: evidence.currency,
      amountCents: evidence.amountCents,
      rawEventId: evidence.providerEventId ?? `reconciliation:${evidence.providerPaymentIntentId}`,
      raw: evidence.raw,
      createdAt: now
    });
  }

  // The current money is now recorded exactly once. Anything that cannot be
  // proven stays a visible exception with its places held; a sale already
  // closed (for example by a refund) is never reopened.
  const retain = (code: string) =>
    sale.status === "payment_pending" ? blockPaidFulfillment(code, {}) : raise(code, true);
  // Correlated to this sale's own attempt, but the intent's other rows exceed
  // the bound: money kept, ownership left for staff.
  if (ownership.kind === "unverified") return retain("paid_payment_identity_unverified");
  if (byIntent.kind === "duplicate" || byProviderId.kind === "duplicate") return retain("paid_payment_ledger_duplicate");
  // An existing record of this payment is reused only when it is exactly the
  // confirmed facts. A legacy or corrupt row is kept as stored (never
  // rewritten or backfilled) and the current facts become the exception.
  if (samePayment && !samePaidRecord(intentRows[0], providerRows[0], {
    providerPaymentId: evidence.providerPaymentIntentId,
    providerPaymentIntentId: evidence.providerPaymentIntentId,
    amountCents: evidence.amountCents,
    currency: evidence.currency
  })) {
    return retain("paid_payment_record_mismatch");
  }
  // A second, distinct payment for one sale: keep the money and the one
  // booking, and let staff decide on a refund.
  if (!samePayment && otherPaid) return retain("duplicate_payment_for_sale");

  const markAttemptPaid = async () => {
    if (!attempt) return;
    const current = (await ctx.db.get(attempt._id))!;
    if (current.status !== "paid") {
      await patchTerminalAttempt(ctx, current, {
        status: "paid",
        providerPaymentIntentId: evidence.providerPaymentIntentId,
        reconcileAt: undefined,
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        lastProviderState: "succeeded",
        settledAt: now
      }, now);
    }
  };

  const lines = await ctx.db
    .query("posSaleLines")
    .withIndex("by_saleRef", (q) => q.eq("saleRef", evidence.saleRef))
    .take(posStoredLineLimit + 1);

  if (sale.status === "paid") {
    await markAttemptPaid();
    const bookings = await saleBookings(ctx, evidence.saleRef);
    if (bookings.length > 1) return raise("paid_booking_duplicate", true);
    // An unresolved billing exception wins: a repeat never queues a ticket
    // or reports fulfillment while staff still have to decide.
    const open = await openBillingExceptionsForSale(ctx, evidence.saleRef);
    if (open.length > 0) return { kind: "exception", code: open[0].code, moneyRecorded: true };
    // Another distinct paid record, or a paid history too long to read: the
    // current money stays recorded, but nothing is re-delivered (cafe-only
    // sales included).
    if (otherPaid) return raise("paid_owner_payment_ambiguous", true);
    const booking = bookings[0];
    if (booking) {
      // A repeat reuses the one booking and delivery and never touches its
      // redemption or departure history.
      if (booking.status === "confirmed") {
        // The same canonical proof the door and ticket view use, before any
        // delivery is queued; only classified proof failures are caught.
        const proof = await bookingPaidProof(ctx, booking);
        if (!proof.ok) return raise("paid_booking_proof_invalid", true, { proofReason: proof.reason });
        try {
          await assertTicketDeliveryReady(ctx, {
            ticketCode: evidence.ticketCode, bookingRef: booking.bookingRef,
            saleRef: evidence.saleRef, emailLower: booking.emailLower, now
          });
        } catch {
          return raise("paid_ticket_delivery_invalid", true);
        }
        await ensureTicketDelivery(ctx, {
          ticketCode: evidence.ticketCode,
          bookingRef: booking.bookingRef,
          saleRef: evidence.saleRef,
          emailLower: booking.emailLower,
          now
        });
      }
      return { kind: "fulfilled", bookingRef: booking.bookingRef, repeated: true };
    }
    let hasAdmission = true;
    try { hasAdmission = posTicketPartySize(lines) > 0; } catch { /* keep conservative */ }
    if (!hasAdmission) {
      try {
        if (lines.length > posStoredLineLimit) throw new Error("too many stored lines");
        assertStoredPaymentLineProvenance(lines, "POS Terminal settlement");
        if (!saleTotalsValid(sale, lines)) throw new Error("stored totals do not reconcile");
      } catch {
        return raise("paid_sale_snapshot_invalid", true);
      }
      return { kind: "fulfilled", repeated: true };
    }
    return raise("paid_sale_without_booking", true);
  }

  if (sale.status !== "payment_pending") {
    if (samePayment) return { kind: "ignored", reason: "sale_status_not_payable" };
    return blockPaidFulfillment(sale.status === "draft" ? "paid_sale_state_unexpected" : "paid_after_sale_closed", {
      saleStatus: sale.status
    });
  }

  if (ownerPaid.overflow) return blockPaidFulfillment("paid_owner_history_unverified", {});

  let fulfillment: ReturnType<typeof buildConfirmedPosFulfillment>;
  try {
    if (lines.length > posStoredLineLimit) throw new Error("too many stored lines");
    assertStoredPaymentLineProvenance(lines, "POS Terminal settlement");
    if (!saleTotalsValid(sale, lines)) throw new Error("stored totals do not reconcile");
    if (posTicketPartySize(lines) > 0 && (!sale.visitDate || !sale.entryTime)) {
      // Older register sales never stored a visit; no timing is invented.
      return blockPaidFulfillment("paid_pos_visit_unknown", {});
    }
    fulfillment = buildConfirmedPosFulfillment(sale, lines, now);
  } catch (error) {
    return blockPaidFulfillment("paid_sale_snapshot_invalid", {
      detail: (error instanceof Error ? error.message : "invalid snapshot").slice(0, 200)
    });
  }

  if (!fulfillment) {
    // Cafe and custom items only: paid, with no admission ticket.
    await ctx.db.patch(sale._id, { status: "paid", updatedAt: now });
    await markAttemptPaid();
    await auditPaid(ctx, sale, evidence, now, undefined);
    return { kind: "fulfilled", repeated: false };
  }

  // Valid from the selected entry time until closing of the entered segment
  // on the selected LA date. Neither the signed payment time nor this
  // processing time may fall after it; nothing moves to another day.
  const booking = fulfillment.booking;
  let hours: Awaited<ReturnType<typeof loadVenueHours>>;
  try {
    hours = await loadVenueHours(ctx);
  } catch (error) {
    // Untrusted stored hours never authorize a ticket; the exception path
    // below does not read hours again.
    if (!(error instanceof VenueHoursIntegrityError)) throw error;
    return blockPaidFulfillment("paid_venue_hours_unverified", { integrity: error.code }, booking);
  }
  // Known ledger corruption is classified, never thrown, so it cannot roll
  // back the paid row above; the sale's places stay held.
  const reservationLookup = await lookupCapacityReservation(ctx, { saleRef: evidence.saleRef });
  if (reservationLookup.kind === "inconsistent") {
    return blockPaidFulfillment("paid_capacity_reservation_inconsistent", { integrity: reservationLookup.code }, booking);
  }
  const reservation = reservationLookup.reservation;
  const existingBookings = await saleBookings(ctx, evidence.saleRef);
  if (existingBookings.length > 1) return blockPaidFulfillment("paid_booking_duplicate", {}, booking);
  const window = visitEntitlementWindow(hours, booking.visitDate, booking.entryTime);
  const windowEnd =
    reservation && reservation.visitDate === booking.visitDate && reservation.entryTime === booking.entryTime
      ? reservation.endMinutes
      : window?.endMinutes ?? venueDayMinutes;
  const paidAt = evidence.paidAt ?? now;
  if (!instantBeforeVisitWindowEnd(paidAt, booking.visitDate, windowEnd)) {
    return blockPaidFulfillment("paid_after_visit_window", { paidAt, windowEndMinutes: windowEnd }, booking);
  }
  if (!instantBeforeVisitWindowEnd(now, booking.visitDate, windowEnd)) {
    return blockPaidFulfillment("paid_fulfillment_after_visit_window", { paidAt, windowEndMinutes: windowEnd }, booking);
  }

  const existingBooking = existingBookings[0];
  const mismatch =existingBooking ? bookingMismatch(existingBooking, booking) : undefined;
  if (mismatch) return blockPaidFulfillment("paid_booking_mismatch", { field: mismatch }, booking);
  if (
    reservation &&
    (reservation.visitDate !== booking.visitDate ||
      reservation.entryTime !== booking.entryTime ||
      reservation.partySize !== booking.partySize)
  ) {
    return blockPaidFulfillment("paid_capacity_reservation_mismatch", {}, booking);
  }
  try {
    await assertTicketDeliveryReady(ctx, {
      ticketCode: evidence.ticketCode, bookingRef: booking.bookingRef,
      saleRef: evidence.saleRef, emailLower: booking.emailLower, now
    });
  } catch {
    return blockPaidFulfillment("paid_ticket_delivery_invalid", {}, booking);
  }

  // Recheck the shared calendar without this sale's own hold: a confirmed
  // private event, unverifiable occupancy or a full date becomes a counted
  // exception instead of a ticket. The selected date is never moved.
  if (!existingBooking) {
    const occupancy = await loadDateOccupancy(ctx, booking.visitDate, hours, { exclude: { saleRef: evidence.saleRef } });
    const decision = decideCapacity(occupancy, hours, booking);
    if (!decision.ok) {
      await ctx.db.insert("auditEvents", {
        action: "pos.capacityException",
        entityType: "posSale",
        entityRef: evidence.saleRef,
        metadata: {
          reason: decision.reason,
          visitDate: booking.visitDate,
          entryTime: booking.entryTime,
          partySize: booking.partySize,
          providerPaymentIntentId: evidence.providerPaymentIntentId,
          amountCents: evidence.amountCents
        },
        createdAt: now
      });
      return blockPaidFulfillment("paid_sale_capacity_exception", { capacityReason: decision.reason }, booking);
    }
  }

  if (reservation) {
    if (reservation.status !== "paid") {
      await ctx.db.patch(reservation._id, {
        status: "paid",
        bookingRef: booking.bookingRef,
        paidAt: now,
        releasedAt: undefined,
        releaseReason: undefined,
        updatedAt: now
      });
    }
  } else {
    await insertSaleReservation(ctx, booking, "paid", now, window);
  }
  if (!existingBooking) {
    await ctx.db.insert("bookings", booking);
    await ctx.db.insert("auditEvents", {
      action: "pos.bookingFulfilled",
      entityType: "booking",
      entityRef: booking.bookingRef,
      metadata: fulfillment.auditMetadata,
      createdAt: now
    });
  }
  await ensureTicketDelivery(ctx, {
    ticketCode: evidence.ticketCode,
    bookingRef: booking.bookingRef,
    saleRef: evidence.saleRef,
    emailLower: booking.emailLower,
    now
  });
  await ctx.db.patch(sale._id, { status: "paid", updatedAt: now });
  await markAttemptPaid();
  await auditPaid(ctx, sale, evidence, now, booking.bookingRef);
  return { kind: "fulfilled", bookingRef: booking.bookingRef, repeated: false };

  async function blockPaidFulfillment(
    code: string,
    extra: Record<string, Scalar>,
    booking?: ConfirmedPosBooking
  ): Promise<TerminalPaidResult> {
    // The money is real: the sale is paid, its places stay counted, and no
    // ticket or confirmation is issued until staff resolve the exception.
    const current = sale as SaleDoc;
    if (current.status !== "paid") await ctx.db.patch(current._id, { status: "paid", updatedAt: now });
    // The sale's single hold becomes a counted exception; ambiguous holds are
    // left as stored (still counted, never released). A party with no hold
    // at all gets a conservative exception hold.
    const held = await holdPaidExceptionCapacity(ctx, { saleRef: evidence.saleRef }, `paid_unfulfilled:${code}`, now);
    if (held === "none" && booking) {
      await insertSaleReservation(ctx, booking, "exception", now, undefined, `paid_unfulfilled:${code}`);
    }
    return raise(code, true, extra);
  }
}

async function insertSaleReservation(
  ctx: MutationCtx,
  booking: ConfirmedPosBooking,
  status: "paid" | "exception",
  now: number,
  window: { startMinutes: number; endMinutes: number } | null | undefined,
  exceptionReason?: string
) {
  // Conservative span when hours no longer place the entry: entry to midnight.
  const span = window ?? { startMinutes: visitTimeMinutes(booking.entryTime) ?? 0, endMinutes: venueDayMinutes };
  await ctx.db.insert("capacityReservations", {
    saleRef: booking.saleRef,
    visitDate: booking.visitDate,
    entryTime: booking.entryTime,
    startMinutes: span.startMinutes,
    endMinutes: span.endMinutes,
    partySize: booking.partySize,
    status,
    ...(status === "paid" ? { bookingRef: booking.bookingRef, paidAt: now } : { exceptionReason }),
    createdAt: now,
    updatedAt: now
  });
}

async function auditPaid(
  ctx: MutationCtx,
  sale: SaleDoc,
  evidence: TerminalIntentFacts,
  now: number,
  bookingRef: string | undefined
) {
  await ctx.db.insert("auditEvents", {
    action: "pos.terminalPayment.paid",
    entityType: "posSale",
    entityRef: sale.saleRef,
    metadata: Object.fromEntries(
      Object.entries({
        amountCents: evidence.amountCents,
        providerPaymentIntentId: evidence.providerPaymentIntentId,
        providerEventId: evidence.providerEventId,
        source: evidence.source,
        bookingRef
      }).filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    ),
    createdAt: now
  });
}

/**
 * A provider-verified cancellation of the correlated intent: the only unpaid
 * outcome that closes a POS sale and releases its unpaid hold. Paid and
 * exception holds are never reopened.
 */
export async function settlePosCanceled(ctx: MutationCtx, evidence: TerminalIntentFacts, now: number): Promise<TerminalUnpaidResult> {
  const checked = await checkUnpaidCorrelation(ctx, evidence);
  if (checked.kind === "rejected") return checked;
  const { sale } = checked;
  let { attempt } = checked;
  if (attempt && evidence.intentStatus !== "canceled") return { kind: "rejected", reason: "unpaid_intent_facts_invalid" };
  if (evidence.intentStatus !== undefined && evidence.intentStatus !== "canceled") {
    return { kind: "rejected", reason: "unpaid_intent_status_mismatch" };
  }
  if (attempt && checked.intentLearned) attempt = await learnIntent(ctx, attempt, evidence.providerPaymentIntentId, now);

  await ctx.db.insert("paymentEvents", {
    saleRef: sale.saleRef,
    provider: "terminal",
    providerPaymentId: evidence.providerPaymentIntentId,
    providerPaymentIntentId: evidence.providerPaymentIntentId,
    idempotencyKey: attempt?.providerIdempotencyKey ?? checked.legacyKey,
    status: "canceled",
    currency: sale.currency,
    amountCents: sale.totalCents,
    rawEventId: evidence.providerEventId ?? `reconciliation:${evidence.providerPaymentIntentId}`,
    raw: evidence.raw,
    createdAt: now
  });
  await ctx.db.patch(sale._id, { status: "canceled", updatedAt: now });
  await releaseUnpaidCapacityHold(
    ctx,
    { saleRef: sale.saleRef },
    evidence.source === "webhook" ? `stripe:${evidence.eventType}` : "stripe:intent_canceled_reconciled",
    now
  );
  if (attempt) {
    const current = (await ctx.db.get(attempt._id))!;
    await patchTerminalAttempt(ctx, current, {
      status: "canceled",
      reconcileAt: undefined,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      lastProviderState: "canceled",
      settledAt: now
    }, now);
  }
  await ctx.db.insert("auditEvents", {
    action: "pos.terminalPayment.canceled",
    entityType: "posSale",
    entityRef: sale.saleRef,
    metadata: { providerPaymentIntentId: evidence.providerPaymentIntentId, source: evidence.source },
    createdAt: now
  });
  return { kind: "recorded" };
}

/**
 * A decline or reader failure is not a cancellation: the same intent stays
 * payable and is reused, so the sale and its hold are left untouched.
 */
export async function recordPosPaymentFailed(ctx: MutationCtx, evidence: TerminalIntentFacts, now: number): Promise<TerminalUnpaidResult> {
  const checked = await checkUnpaidCorrelation(ctx, evidence);
  if (checked.kind === "rejected") return checked;
  const { sale } = checked;
  let { attempt } = checked;
  if (attempt && checked.intentLearned) attempt = await learnIntent(ctx, attempt, evidence.providerPaymentIntentId, now);
  await ctx.db.insert("paymentEvents", {
    saleRef: sale.saleRef,
    provider: "terminal",
    providerPaymentId: evidence.providerPaymentIntentId,
    providerPaymentIntentId: evidence.providerPaymentIntentId,
    idempotencyKey: attempt?.providerIdempotencyKey ?? checked.legacyKey,
    status: "failed",
    currency: sale.currency,
    amountCents: sale.totalCents,
    rawEventId: evidence.providerEventId,
    raw: evidence.raw,
    createdAt: now
  });
  if (attempt) {
    // Bookkeeping only; reader handoff stays available for the same intent.
    await ctx.db.patch(attempt._id, { lastProviderState: "payment_failed", updatedAt: now });
  }
  return { kind: "recorded" };
}

async function checkUnpaidCorrelation(ctx: MutationCtx, evidence: TerminalIntentFacts) {
  const sales = await ctx.db
    .query("posSales")
    .withIndex("by_saleRef", (q) => q.eq("saleRef", evidence.saleRef))
    .take(2);
  if (sales.length > 1) return { kind: "rejected" as const, reason: "pos_sale_duplicate" };
  const sale = sales[0];
  if (!sale) return { kind: "rejected" as const, reason: "pos_sale_not_found" };
  const correlation = await correlateTerminalIntent(ctx, evidence);
  if (correlation.conflict) return { kind: "rejected" as const, reason: correlation.conflict };
  const attempt = correlation.attempt;
  if (!attempt && !correlation.legacyEvent) return { kind: "rejected" as const, reason: "terminal_intent_not_created_by_convex" };
  if ((attempt || evidence.intentSource !== undefined) && evidence.intentSource !== terminalIntentSource) {
    return { kind: "rejected" as const, reason: "unpaid_intent_source_invalid" };
  }
  if (attempt && evidence.livemode !== (attempt.stripeMode === "live")) {
    return { kind: "rejected" as const, reason: "unpaid_intent_livemode_mismatch" };
  }
  const expectedAmount = attempt?.amountCents ?? correlation.legacyEvent!.amountCents;
  if (
    (evidence.amountCents !== undefined && evidence.amountCents !== expectedAmount) ||
    (evidence.currency !== undefined && evidence.currency !== sale.currency) ||
    expectedAmount !== sale.totalCents
  ) {
    return { kind: "rejected" as const, reason: "amount_or_currency_mismatch" };
  }
  if (sale.status === "paid" || attempt?.status === "paid") return { kind: "rejected" as const, reason: "pos_sale_already_paid" };
  if (sale.status === "canceled") return { kind: "rejected" as const, reason: "pos_sale_already_canceled" };
  if (sale.status !== "payment_pending") return { kind: "rejected" as const, reason: "pos_sale_status_not_reconcilable" };
  // Paid subsets only: any amount of decline history cannot hide paid money.
  if (await hasPaidEventForSale(ctx, sale.saleRef)) return { kind: "rejected" as const, reason: "pos_sale_already_paid" };
  if (await hasPaidEventForIntent(ctx, evidence.providerPaymentIntentId)) {
    return { kind: "rejected" as const, reason: "payment_intent_already_paid" };
  }
  return {
    kind: "ok" as const,
    sale,
    attempt,
    intentLearned: correlation.intentLearned,
    legacyKey: correlation.legacyEvent?.idempotencyKey
  };
}

/** Bookings for a sale; more than one is a corrupt ledger the caller reports. */
async function saleBookings(ctx: MutationCtx, saleRef: string) {
  return ctx.db
    .query("bookings")
    .withIndex("by_saleRef", (q) => q.eq("saleRef", saleRef))
    .take(2);
}

function bookingMismatch(
  existing: Pick<Doc<"bookings">, "bookingRef" | "saleRef" | "visitDate" | "entryTime" | "partySize" | "emailLower">,
  expected: ConfirmedPosBooking
) {
  return immutableBookingFields.find((field) => existing[field] !== expected[field]);
}
