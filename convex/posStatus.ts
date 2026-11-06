import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { assertBookingPaid } from "./lib/admission";
import { requireStaffUser } from "./lib/auth";
import { hasOpenBillingExceptionForSale } from "./lib/operationsExceptions";
import { checkIntentOwnership } from "./lib/paymentEvidence";
import { assertStoredPaymentLineProvenance } from "./lib/orderDraftPersistence";
import { posTicketPartySize } from "./lib/posFulfillment";
import { assertPosSaleOwner } from "./lib/terminalAttempts";

/**
 * draft: reviewed, no payment started. starting: the frozen create request is
 * in flight. awaiting_payment: the one intent is known and can be sent (again)
 * to the reader. unknown: a payment may exist; never charge again. paid:
 * money confirmed by one correlated paid record with complete provenance.
 * paid_needs_attention: money was received but something (billing, booking,
 * provenance, a partial or pending refund, a closed sale) needs staff review.
 * canceled/closed: no money was ever recorded. refunded: correlated
 * succeeded refunds of that one payment total its full amount.
 */
export type PosPaymentState =
  | "draft"
  | "starting"
  | "awaiting_payment"
  | "unknown"
  | "paid"
  | "paid_needs_attention"
  | "canceled"
  | "closed"
  | "refunded";

export type PosSaleStatus = {
  saleRef: string;
  status: Doc<"posSales">["status"];
  paymentState: PosPaymentState;
  currency: "usd";
  subtotalCents: number;
  feeCents: number;
  totalCents: number;
  paymentStatus?: string;
  visitDate?: string;
  entryTime?: string;
  party?: { adults: number; youths: number; children: number; total: number };
  lines: Array<{ kind: string; name: string; quantity: number; unitAmountCents: number; lineTotalCents: number }>;
  readerId?: string;
  readerRetryAllowed: boolean;
  lastReaderStatus?: string;
  bookingRef?: string;
  /** The linked booking's actual status. */
  bookingStatus?: string;
  /** A ticket delivery exists for this sale; false only when none exists. */
  ticketIssued: boolean;
  /** The ticket was redeemed at the door; stays true after departure or refund. */
  admissionUsed: boolean;
  ticketCode?: string;
  updatedAt: number;
};

const evidenceReadLimit = 100;
// A sale has one booking and one delivery; more is read only to see use.
const bookingReadLimit = 10;

type RefundProof = "none" | "failed_only" | "full" | "partial_or_pending" | "unproven";

export const getPosSaleStatus = query({
  args: { saleRef: v.string() },
  handler: async (ctx, args): Promise<PosSaleStatus> => {
    const staff = await requireStaffUser(ctx, ["admin", "pos"]);
    const saleRef = args.saleRef.trim();
    if (!saleRef || saleRef.length > 80) throw new Error("saleRef is invalid");
    const sale = await ctx.db
      .query("posSales")
      .withIndex("by_saleRef", (q) => q.eq("saleRef", saleRef))
      .unique();
    if (!sale) throw new Error("POS sale was not found");
    // Checked before any bearer field is read or returned.
    assertPosSaleOwner(staff, sale);

    const [lines, paidRows, latestPayment, saleRefund, saleBookings, deliveries, attempt, billingOpen] = await Promise.all([
      ctx.db.query("posSaleLines").withIndex("by_saleRef", (q) => q.eq("saleRef", saleRef)).take(evidenceReadLimit + 1),
      // Paid money is read on its own index so decline or pending history can
      // never push it out of the bounded read.
      ctx.db
        .query("paymentEvents")
        .withIndex("by_saleRef_status", (q) => q.eq("saleRef", saleRef).eq("status", "paid"))
        .take(evidenceReadLimit + 1),
      ctx.db.query("paymentEvents").withIndex("by_saleRef", (q) => q.eq("saleRef", saleRef)).order("desc").first(),
      ctx.db.query("refunds").withIndex("by_saleRef_updatedAt", (q) => q.eq("saleRef", saleRef)).first(),
      ctx.db.query("bookings").withIndex("by_saleRef", (q) => q.eq("saleRef", saleRef)).take(bookingReadLimit + 1),
      ctx.db.query("ticketDeliveries").withIndex("by_saleRef", (q) => q.eq("saleRef", saleRef)).take(bookingReadLimit + 1),
      ctx.db.query("terminalPaymentAttempts").withIndex("by_saleRef", (q) => q.eq("saleRef", saleRef)).first(),
      hasOpenBillingExceptionForSale(ctx, saleRef)
    ]);

    // Every booking this sale or its deliveries name is a candidate. Use is
    // positive evidence from any of them; usability needs exactly one.
    const candidateRefs = [
      ...new Set([...saleBookings.map((row) => row.bookingRef), ...deliveries.map((row) => row.bookingRef)])
    ].slice(0, 2 * (bookingReadLimit + 1));
    const [refBookings, admissions] = await Promise.all([
      Promise.all(
        candidateRefs.map((ref) =>
          ctx.db.query("bookings").withIndex("by_bookingRef", (q) => q.eq("bookingRef", ref)).take(2)
        )
      ),
      Promise.all(
        candidateRefs.map((ref) =>
          ctx.db.query("bookingAdmissions").withIndex("by_bookingRef", (q) => q.eq("bookingRef", ref)).first()
        )
      )
    ]);
    const candidateBookings = new Map<string, Doc<"bookings">>();
    for (const row of [...saleBookings, ...refBookings.flat()]) candidateBookings.set(row._id, row);
    const admissionUsed =
      admissions.some((row) => row !== null) || [...candidateBookings.values()].some(bookingShowsUse);

    const booking =
      saleBookings.length === 1 &&
      candidateBookings.size === 1 &&
      refBookings.every((rows) => rows.length <= 1)
        ? saleBookings[0]
        : undefined;
    const delivery = deliveries.length === 1 ? deliveries[0] : undefined;

    const ticketLines = lines.filter((line) => line.kind === "ticket");
    const hasAdmission = ticketLines.length > 0;
    const linesComplete = lines.length <= evidenceReadLimit && provenanceHolds(lines) && storedMoneyHolds(sale, lines);
    const moneyReceived = paidRows.length > 0;

    // One paid record of this sale's own intent, amount and currency.
    const candidate =
      paidRows.length === 1 &&
      paidRows[0].provider === "terminal" &&
      paidRows[0].orderRef === undefined &&
      paidRows[0].saleRef === saleRef &&
      Boolean(paidRows[0].providerPaymentIntentId) &&
      paidRows[0].amountCents === sale.totalCents &&
      paidRows[0].currency === sale.currency &&
      (!attempt || attempt.providerPaymentIntentId === paidRows[0].providerPaymentIntentId)
        ? paidRows[0]
        : undefined;
    // Every ledger row of that intent, pending or settled, must be this sale's
    // own Terminal row; a foreign or unverifiable owner is never proof.
    const ownership = candidate
      ? await checkIntentOwnership(
          ctx,
          candidate.providerPaymentIntentId!,
          (row) => row.provider === "terminal" && row.saleRef === saleRef && row.orderRef === undefined
        )
      : undefined;
    const payment = ownership?.kind === "exclusive" ? candidate : undefined;

    let refundProof: RefundProof = "unproven";
    if (payment) {
      const refunds = await ctx.db
        .query("refunds")
        .withIndex("by_providerPaymentIntentId", (q) => q.eq("providerPaymentIntentId", payment.providerPaymentIntentId!))
        .take(evidenceReadLimit + 1);
      refundProof = refundProofFor(refunds, payment, saleRef);
    }

    const bookingHonored = Boolean(
      moneyReceived &&
        booking &&
        (booking.status === "confirmed" || booking.status === "checked-in") &&
        (await bookingPaymentHolds(ctx, booking))
    );

    let paymentState: PosPaymentState;
    if (moneyReceived) {
      if (payment && refundProof === "full") {
        paymentState = "refunded";
      } else if (
        payment &&
        sale.status === "paid" &&
        linesComplete &&
        !billingOpen &&
        (refundProof === "none" || refundProof === "failed_only") &&
        (!hasAdmission || bookingHonored)
      ) {
        paymentState = "paid";
      } else {
        // Money was received; a closed, canceled or expired sale, a partial,
        // pending or uncorrelated refund, or incomplete provenance is never
        // shown as no charge or as refunded.
        paymentState = "paid_needs_attention";
      }
    } else if (sale.status === "paid" || attempt?.status === "paid" || saleRefund) {
      // A paid status or refund without a stored paid record is not proof of
      // money either way.
      paymentState = "unknown";
    } else if (attempt?.status === "canceled") {
      paymentState = "canceled";
    } else if (sale.status === "canceled" || sale.status === "expired") {
      paymentState = attempt && attempt.status !== "rejected" ? "unknown" : "closed";
    } else if (sale.status === "draft" && !attempt) {
      paymentState = "draft";
    } else if (attempt?.status === "open") {
      paymentState = "awaiting_payment";
    } else if (attempt?.status === "creating" && attempt.leaseExpiresAt !== undefined && attempt.leaseExpiresAt > Date.now()) {
      paymentState = "starting";
    } else {
      // creation_unknown, an attempt exception or an older pending sale: a
      // payable intent may exist, so nothing here may start a second one.
      paymentState = "unknown";
    }

    // The bearer code is offered only while it can still admit the party once:
    // one paid, proven booking of this sale and one delivery of that booking.
    const ticketUsable =
      paymentState === "paid" &&
      hasAdmission &&
      bookingHonored &&
      booking?.status === "confirmed" &&
      booking.saleRef === saleRef &&
      booking.orderRef === undefined &&
      !admissionUsed &&
      delivery?.saleRef === saleRef &&
      delivery.orderRef === undefined &&
      delivery.bookingRef === booking.bookingRef;

    const party = hasAdmission ? partyCounts(ticketLines) : undefined;
    return {
      saleRef,
      status: sale.status,
      paymentState,
      currency: sale.currency,
      subtotalCents: sale.subtotalCents,
      feeCents: sale.feeCents,
      totalCents: sale.totalCents,
      paymentStatus: latestPayment?.status,
      visitDate: sale.visitDate,
      entryTime: sale.entryTime,
      party,
      lines: lines.slice(0, evidenceReadLimit).map((line) => ({
        kind: line.kind,
        name: line.name,
        quantity: line.quantity,
        unitAmountCents: line.unitAmountCents,
        lineTotalCents: line.lineTotalCents
      })),
      readerId: sale.readerId,
      readerRetryAllowed: paymentState === "awaiting_payment",
      lastReaderStatus: attempt?.lastReaderStatus,
      bookingRef: booking?.bookingRef,
      bookingStatus: booking?.status,
      ticketIssued: deliveries.length > 0,
      admissionUsed,
      ticketCode: ticketUsable && delivery ? delivery.ticketCode : undefined,
      updatedAt: sale.updatedAt
    };
  }
});

/**
 * Only succeeded refunds of this sale's own Terminal intent, in its currency,
 * prove money went back. Any refund outside that scope, an unbounded history
 * or a refund still in flight leaves the outcome unproven.
 */
function refundProofFor(
  refunds: Array<Doc<"refunds">>,
  payment: Doc<"paymentEvents">,
  saleRef: string
): RefundProof {
  if (refunds.length > evidenceReadLimit) return "unproven";
  if (refunds.length === 0) return "none";
  let succeededCents = 0;
  let inFlight = false;
  // Each provider refund counts once; a repeated or missing id is ambiguous.
  const refundIds = new Set<string>();
  for (const refund of refunds) {
    if (
      typeof refund.providerRefundId !== "string" ||
      !refund.providerRefundId.trim() ||
      refundIds.has(refund.providerRefundId) ||
      refund.paymentProvider !== "terminal" ||
      refund.saleRef !== saleRef ||
      refund.orderRef !== undefined ||
      refund.providerPaymentIntentId !== payment.providerPaymentIntentId ||
      refund.currency !== payment.currency ||
      !Number.isSafeInteger(refund.amountCents) ||
      refund.amountCents <= 0
    ) {
      return "unproven";
    }
    refundIds.add(refund.providerRefundId);
    if (refund.status === "succeeded") succeededCents += refund.amountCents;
    if (!Number.isSafeInteger(succeededCents)) return "unproven";
    else if (refund.status === "pending" || refund.status === "requires_action") inFlight = true;
  }
  if (succeededCents === payment.amountCents && !inFlight) return "full";
  if (succeededCents > payment.amountCents) return "unproven";
  if (succeededCents === 0 && !inFlight) return "failed_only";
  return "partial_or_pending";
}

function provenanceHolds(lines: Array<Doc<"posSaleLines">>) {
  try {
    assertStoredPaymentLineProvenance(lines, "POS status");
    posTicketPartySize(lines);
    return true;
  } catch {
    return false;
  }
}

/** Stored sale money: safe USD integers whose lines, fee and total agree. */
function storedMoneyHolds(sale: Doc<"posSales">, lines: Array<Doc<"posSaleLines">>) {
  const { subtotalCents, feeCents, totalCents } = sale;
  if (
    sale.currency !== "usd" ||
    !Number.isSafeInteger(subtotalCents) || subtotalCents < 0 ||
    !Number.isSafeInteger(feeCents) || feeCents < 0 ||
    !Number.isSafeInteger(totalCents) || totalCents <= 0
  ) {
    return false;
  }
  const linesCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  return Number.isSafeInteger(linesCents) && linesCents === subtotalCents && subtotalCents + feeCents === totalCents;
}

/**
 * The admission's own settlement proof (sale, lines, party, visit, global paid
 * ownership, billing). Any rejection is staff attention, never a bearer.
 */
async function bookingPaymentHolds(ctx: QueryCtx, booking: Doc<"bookings">) {
  try {
    await assertBookingPaid(ctx, booking);
    return true;
  } catch {
    return false;
  }
}

function bookingShowsUse(booking: Doc<"bookings">) {
  return (
    booking.checkedInAt !== undefined ||
    booking.status === "checked-in" ||
    booking.departedAt !== undefined ||
    booking.admissionTracked === true ||
    (booking.admittedPartySize ?? 0) > 0 ||
    (booking.departedPartySize ?? 0) > 0
  );
}

function partyCounts(lines: Array<Pick<Doc<"posSaleLines">, "quantity" | "metadata">>) {
  const count = (category: string) =>
    lines.reduce((sum, line) => (line.metadata?.ageCategory === category ? sum + line.quantity : sum), 0);
  const adults = count("adult");
  const youths = count("youth");
  const children = count("child");
  return { adults, youths, children, total: lines.reduce((sum, line) => sum + line.quantity, 0) };
}
