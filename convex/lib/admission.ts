import { venueClock, venueCapacity, visitEntitlementWindow } from "@skyla/payments";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { StaffUser } from "./auth";
import { findCapacityReservation, loadDateOccupancy, loadVenueHours, ticketPartySize } from "./capacity";
import { assertStoredPaymentLineProvenance } from "./orderDraftPersistence";
import { bookingAdmission, loadPhysicalOccupancy, remainingAdmissionParty } from "./occupancy";
import { hasOpenBillingExceptionForOrder, hasOpenBillingExceptionForSale } from "./operationsExceptions";
import { checkIntentOwnership, paidIdentityForIntent, paidIdentityForProviderPayment } from "./paymentEvidence";

type Ctx = MutationCtx | QueryCtx;
const proofReadLimit = 100;
/** A classified paid-proof or admission refusal; other errors are unexpected. */
export class AdmissionBlockedError extends Error {
  constructor(readonly reason: string) {
    super(`Admission blocked: ${reason}`);
    this.name = "AdmissionBlockedError";
  }
}
function blocked(reason: string): never { throw new AdmissionBlockedError(reason); }

/** Canonical paid proof as a classified result; unexpected failures still throw. */
export async function bookingPaidProof(ctx: Ctx, booking: Doc<"bookings">) {
  try {
    return { ok: true as const, partySize: await assertBookingPaid(ctx, booking) };
  } catch (error) {
    if (error instanceof AdmissionBlockedError) return { ok: false as const, reason: error.reason };
    throw error;
  }
}

/** Uses only trusted, stored settlement. Browser flags and confirmed text are insufficient. */
export async function assertBookingPaid(ctx: Ctx, booking: Doc<"bookings">) {
  if (Boolean(booking.orderRef) === Boolean(booking.saleRef)) blocked("payment provenance needs reconciliation");
  const ref = booking.orderRef ?? booking.saleRef!;
  const entities = booking.orderRef
    ? await ctx.db.query("orders").withIndex("by_orderRef", q => q.eq("orderRef", ref)).take(2)
    : await ctx.db.query("posSales").withIndex("by_saleRef", q => q.eq("saleRef", ref)).take(2);
  if (entities.length > 1) blocked("payment provenance needs reconciliation");
  const entity = entities[0];
  if (!entity || entity.status !== "paid") blocked("payment is not confirmed");
  if (!Number.isSafeInteger(entity.totalCents) || entity.totalCents <= 0 ||
      !Number.isSafeInteger(entity.feeCents) || entity.feeCents < 0 || entity.currency !== "usd") blocked("stored money needs reconciliation");
  // Paid and open-billing subsets only: declines and resolved history can
  // neither hide a blocker nor deny an otherwise proven guest. Overflow of a
  // subset is itself ambiguous and blocks.
  const [lines, paid, openBilling] = await Promise.all([
    booking.orderRef
      ? ctx.db.query("orderLineItems").withIndex("by_orderRef", q => q.eq("orderRef", ref)).take(proofReadLimit + 1)
      : ctx.db.query("posSaleLines").withIndex("by_saleRef", q => q.eq("saleRef", ref)).take(proofReadLimit + 1),
    booking.orderRef
      ? ctx.db.query("paymentEvents").withIndex("by_orderRef_status", q => q.eq("orderRef", ref).eq("status", "paid")).take(proofReadLimit + 1)
      : ctx.db.query("paymentEvents").withIndex("by_saleRef_status", q => q.eq("saleRef", ref).eq("status", "paid")).take(proofReadLimit + 1),
    booking.orderRef ? hasOpenBillingExceptionForOrder(ctx, ref) : hasOpenBillingExceptionForSale(ctx, ref)
  ]);
  if ([lines, paid].some(rows => rows.length > proofReadLimit)) blocked("payment evidence needs reconciliation");
  if (openBilling) blocked("billing needs staff review");
  if (lines.some(line => !Number.isSafeInteger(line.quantity) || line.quantity < 1 ||
      !Number.isSafeInteger(line.unitAmountCents) || line.unitAmountCents < 0 ||
      !Number.isSafeInteger(line.lineTotalCents) || line.lineTotalCents < 0)) {
    blocked("ticket quantities or prices need reconciliation");
  }
  try { assertStoredPaymentLineProvenance(lines, "Admission"); }
  catch { blocked("ticket quantities or prices need reconciliation"); }
  const partySize = ticketPartySize(lines);
  if (!Number.isSafeInteger(partySize) || partySize < 1 || partySize > venueCapacity || partySize !== booking.partySize) {
    blocked("party count needs reconciliation");
  }
  if (lines.reduce((sum, line) => sum + line.lineTotalCents, 0) + entity.feeCents !== entity.totalCents) {
    blocked("stored total needs reconciliation");
  }
  // Canonical settlement writes exactly one paid row. Two rows, even for the
  // same intent, are corruption, and the one row must be exactly the owner's
  // settled money.
  if (paid.length !== 1) blocked("settled payment needs reconciliation");
  const settled = paid[0]!;
  const provider = booking.orderRef ? "stripe" : "terminal";
  const intentId = settled.providerPaymentIntentId;
  if (!intentId || !settled.providerPaymentId || settled.provider !== provider ||
      settled.orderRef !== booking.orderRef || settled.saleRef !== booking.saleRef ||
      settled.amountCents !== entity.totalCents || settled.currency !== entity.currency ||
      (provider === "terminal" && settled.providerPaymentId !== intentId)) {
    blocked("settled payment needs reconciliation");
  }
  // The same row must be the only paid record of its intent and of its exact
  // provider payment id, and every pending or settled row of the intent must
  // be this owner's: a foreign or unverifiable owner is never proof.
  const [byIntent, byProviderId, ownership] = await Promise.all([
    paidIdentityForIntent(ctx, intentId),
    paidIdentityForProviderPayment(ctx, provider, settled.providerPaymentId),
    checkIntentOwnership(ctx, intentId, row =>
      row.provider === provider && row.orderRef === booking.orderRef && row.saleRef === booking.saleRef &&
      row.providerPaymentId === settled.providerPaymentId)
  ]);
  if (byIntent.kind !== "one" || byIntent.row._id !== settled._id ||
      byProviderId.kind !== "one" || byProviderId.row._id !== settled._id ||
      ownership.kind !== "exclusive") {
    blocked("payment identity needs reconciliation");
  }
  const refunds = await ctx.db.query("refunds")
    .withIndex("by_providerPaymentIntentId_status", q => q.eq("providerPaymentIntentId", intentId).eq("status", "succeeded"))
    .take(proofReadLimit + 1);
  if (refunds.length > proofReadLimit) blocked("refund evidence needs reconciliation");
  // Every succeeded refund must be this settled payment's own: owner,
  // provider, intent, currency and a positive safe amount. A corrupt row can
  // never offset a full refund and authorize entry.
  let refundedCents = 0;
  for (const refund of refunds) {
    if (refund.providerPaymentIntentId !== intentId || refund.paymentProvider !== provider ||
        refund.orderRef !== booking.orderRef || refund.saleRef !== booking.saleRef ||
        refund.currency !== entity.currency || !Number.isSafeInteger(refund.amountCents) || refund.amountCents <= 0) {
      blocked("refund evidence needs reconciliation");
    }
    refundedCents += refund.amountCents;
    if (!Number.isSafeInteger(refundedCents)) blocked("refund evidence needs reconciliation");
  }
  if (refundedCents >= entity.totalCents) blocked("payment was fully refunded");
  // Orders and POS sales both own an immutable selected visit; an older POS
  // sale without one never had valid admission timing.
  if (!entity.visitDate || entity.visitDate !== booking.visitDate) blocked("visit date needs reconciliation");
  if (!entity.entryTime || entity.entryTime !== booking.entryTime) blocked("entry time needs reconciliation");
  return partySize;
}

/** Atomic door redemption: read + insert serialize on the same venue indexes. */
export async function admitBooking(ctx: MutationCtx, booking: Doc<"bookings">, staff: StaffUser, now: number) {
  const previous = await bookingAdmission(ctx, booking.bookingRef);
  if (previous) return { outcome: "already_admitted" as const, admission: previous };
  if (booking.checkedInAt !== undefined || booking.status === "checked-in") blocked("ticket already used; legacy occupancy needs reconciliation");
  if (booking.status !== "confirmed") blocked("booking is not active");
  const partySize = await assertBookingPaid(ctx, booking);
  const hours = await loadVenueHours(ctx);
  const clock = venueClock(now);
  const window = booking.visitDate && booking.entryTime ? visitEntitlementWindow(hours, booking.visitDate, booking.entryTime) : null;
  if (!window || clock.date !== booking.visitDate || clock.minutes < window.startMinutes || clock.minutes >= window.endMinutes) {
    blocked("ticket is valid from its selected entry time until closing on its Los Angeles date");
  }
  const date = await loadDateOccupancy(ctx, booking.visitDate!, hours);
  if (date.privateEvent) blocked("venue is reserved for a private event");
  if (date.unverifiedReason) blocked("availability needs reconciliation");
  const occupancy = await loadPhysicalOccupancy(ctx);
  if (occupancy.unverifiedReason) blocked("physical occupancy needs reconciliation");
  if (occupancy.insideCount + partySize > venueCapacity) blocked(`only ${occupancy.remaining} places are available inside`);
  const admission = {
    bookingRef: booking.bookingRef, visitDate: booking.visitDate!, partySize,
    admittedAt: now, admittedBy: staff._id, departedCount: 0, inside: true, updatedAt: now
  };
  await ctx.db.insert("bookingAdmissions", admission);
  await ctx.db.patch(booking._id, { status: "checked-in", checkedInAt: now, admissionTracked: true, admittedPartySize: partySize, departedPartySize: 0, updatedAt: now });
  await ctx.db.insert("auditEvents", {
    actorStaffUserId: staff._id, action: "admission.redeemed", entityType: "booking", entityRef: booking.bookingRef,
    metadata: { partySize, insideBefore: occupancy.insideCount, insideAfter: occupancy.insideCount + partySize, noReentry: true }, createdAt: now
  });
  return { outcome: "admitted" as const, admission };
}

/** Absolute departed count makes retry safe, even after another partial departure. */
export async function departBooking(ctx: MutationCtx, booking: Doc<"bookings">, staff: StaffUser, departedCount: number, now: number) {
  const admission = await bookingAdmission(ctx, booking.bookingRef);
  if (!admission) blocked("no audited admission; legacy departure needs reconciliation");
  remainingAdmissionParty(admission);
  if (!Number.isSafeInteger(departedCount) || departedCount < 1 || departedCount > admission.partySize) {
    throw new Error(`departedCount must be an integer from 1 to ${admission.partySize}`);
  }
  if (departedCount <= admission.departedCount) return { outcome: "already_recorded" as const, admission };
  const inside = departedCount < admission.partySize;
  const patch = { departedCount, inside, ...(inside ? {} : { departedAt: now }), updatedAt: now };
  await ctx.db.patch(admission._id, patch);
  await ctx.db.patch(booking._id, { departedPartySize: departedCount, ...(inside ? {} : { departedAt: now }), updatedAt: now });
  const owner = booking.orderRef ? { orderRef: booking.orderRef } : booking.saleRef ? { saleRef: booking.saleRef } : undefined;
  if (owner) {
    const reservation = await findCapacityReservation(ctx, owner);
    if (reservation) await ctx.db.patch(reservation._id, { departedCount, ...(inside ? {} : { departedAt: now }), updatedAt: now });
  }
  await ctx.db.insert("auditEvents", {
    actorStaffUserId: staff._id, action: "admission.departureRecorded", entityType: "booking", entityRef: booking.bookingRef,
    metadata: { previousDepartedCount: admission.departedCount, departedCount, remainingInside: admission.partySize - departedCount, noReentry: true }, createdAt: now
  });
  return { outcome: "recorded" as const, admission: { ...admission, ...patch } };
}
