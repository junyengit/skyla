import { venueClock, venueCapacity, visitEntitlementWindow } from "@skyla/payments";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { StaffUser } from "./auth";
import { findCapacityReservation, loadDateOccupancy, loadVenueHours, ticketPartySize } from "./capacity";
import { assertStoredPaymentLineProvenance } from "./orderDraftPersistence";
import { bookingAdmission, loadPhysicalOccupancy, remainingAdmissionParty } from "./occupancy";

type Ctx = MutationCtx | QueryCtx;
const proofReadLimit = 100;
function blocked(reason: string): never { throw new Error(`Admission blocked: ${reason}`); }

/** Uses only trusted, stored settlement. Browser flags and confirmed text are insufficient. */
export async function assertBookingPaid(ctx: Ctx, booking: Doc<"bookings">) {
  if (Boolean(booking.orderRef) === Boolean(booking.saleRef)) blocked("payment provenance needs reconciliation");
  const ref = booking.orderRef ?? booking.saleRef!;
  const entity = booking.orderRef
    ? await ctx.db.query("orders").withIndex("by_orderRef", q => q.eq("orderRef", ref)).unique()
    : await ctx.db.query("posSales").withIndex("by_saleRef", q => q.eq("saleRef", ref)).unique();
  if (!entity || entity.status !== "paid") blocked("payment is not confirmed");
  if (!Number.isSafeInteger(entity.totalCents) || entity.totalCents <= 0 ||
      !Number.isSafeInteger(entity.feeCents) || entity.feeCents < 0 || entity.currency !== "usd") blocked("stored money needs reconciliation");
  const [lines, payments, exceptions] = await Promise.all([
    booking.orderRef
      ? ctx.db.query("orderLineItems").withIndex("by_orderRef", q => q.eq("orderRef", ref)).take(proofReadLimit + 1)
      : ctx.db.query("posSaleLines").withIndex("by_saleRef", q => q.eq("saleRef", ref)).take(proofReadLimit + 1),
    booking.orderRef
      ? ctx.db.query("paymentEvents").withIndex("by_orderRef", q => q.eq("orderRef", ref)).take(proofReadLimit + 1)
      : ctx.db.query("paymentEvents").withIndex("by_saleRef", q => q.eq("saleRef", ref)).take(proofReadLimit + 1),
    booking.orderRef
      ? ctx.db.query("operationsExceptions").withIndex("by_orderRef", q => q.eq("orderRef", ref)).take(proofReadLimit + 1)
      : ctx.db.query("operationsExceptions").withIndex("by_saleRef", q => q.eq("saleRef", ref)).take(proofReadLimit + 1)
  ]);
  if ([lines, payments, exceptions].some(rows => rows.length > proofReadLimit)) blocked("payment evidence needs reconciliation");
  if (exceptions.some(row => row.status === "open" && row.category === "billing")) blocked("billing needs staff review");
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
  const paid = payments.filter(row => row.status === "paid");
  const matching = paid.filter(row => row.amountCents === entity.totalCents && row.currency === entity.currency &&
    Boolean(row.providerPaymentIntentId) && (booking.orderRef ? row.provider === "stripe" : row.provider === "terminal"));
  if (!matching.length || matching.length !== paid.length ||
    new Set(matching.map(row => row.providerPaymentIntentId)).size !== 1) blocked("settled payment needs reconciliation");
  const intentId = matching[0]!.providerPaymentIntentId!;
  const globalPaid = await ctx.db.query("paymentEvents").withIndex("by_providerPaymentIntentId", q => q.eq("providerPaymentIntentId", intentId)).take(proofReadLimit + 1);
  if (globalPaid.length > proofReadLimit || globalPaid.some(row => row.status === "paid" &&
      (row.orderRef !== booking.orderRef || row.saleRef !== booking.saleRef))) blocked("payment identity needs reconciliation");
  const refunds = await ctx.db.query("refunds").withIndex("by_providerPaymentIntentId", q => q.eq("providerPaymentIntentId", intentId)).take(proofReadLimit + 1);
  if (refunds.length > proofReadLimit || refunds.filter(row => row.status === "succeeded").reduce((sum, row) => sum + row.amountCents, 0) >= entity.totalCents) {
    blocked("payment was fully refunded");
  }
  if (booking.orderRef && (entity as Doc<"orders">).visitDate !== booking.visitDate) blocked("visit date needs reconciliation");
  if (booking.orderRef && (entity as Doc<"orders">).entryTime !== booking.entryTime) blocked("entry time needs reconciliation");
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
  if (booking.orderRef) {
    const reservation = await findCapacityReservation(ctx, booking.orderRef);
    if (reservation) await ctx.db.patch(reservation._id, { departedCount, ...(inside ? {} : { departedAt: now }), updatedAt: now });
  }
  await ctx.db.insert("auditEvents", {
    actorStaffUserId: staff._id, action: "admission.departureRecorded", entityType: "booking", entityRef: booking.bookingRef,
    metadata: { previousDepartedCount: admission.departedCount, departedCount, remainingInside: admission.partySize - departedCount, noReentry: true }, createdAt: now
  });
  return { outcome: "recorded" as const, admission: { ...admission, ...patch } };
}
