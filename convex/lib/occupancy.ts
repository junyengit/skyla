import { venueCapacity } from "@skyla/payments";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export const admissionReadLimit = 500;
type Ctx = MutationCtx | QueryCtx;

export function remainingAdmissionParty(admission: Pick<Doc<"bookingAdmissions">, "partySize" | "departedCount" | "inside">) {
  if (!Number.isSafeInteger(admission.partySize) || admission.partySize < 1 || admission.partySize > venueCapacity ||
      !Number.isSafeInteger(admission.departedCount) || admission.departedCount < 0 || admission.departedCount > admission.partySize ||
      admission.inside !== (admission.departedCount < admission.partySize)) {
    throw new Error("Admission blocked: occupancy record needs reconciliation");
  }
  return admission.partySize - admission.departedCount;
}

export async function bookingAdmission(ctx: Ctx, bookingRef: string) {
  return ctx.db.query("bookingAdmissions").withIndex("by_bookingRef", q => q.eq("bookingRef", bookingRef)).unique();
}

/** Physical presence survives billing changes, expiry and LA midnight. */
export async function loadPhysicalOccupancy(ctx: Ctx) {
  const [admissions, timestamped, marked, sources] = await Promise.all([
    ctx.db.query("bookingAdmissions").withIndex("by_inside", q => q.eq("inside", true)).take(admissionReadLimit + 1),
    ctx.db.query("bookings").withIndex("by_admissionTracked_checkedInAt", q => q.eq("admissionTracked", undefined).gte("checkedInAt", 0)).take(admissionReadLimit + 1),
    ctx.db.query("bookings").withIndex("by_admissionTracked_status", q => q.eq("admissionTracked", undefined).eq("status", "checked-in")).take(admissionReadLimit + 1),
    ctx.db.query("legacyMigrationSources").take(51)
  ]);
  let unverifiedReason: string | undefined;
  if ([admissions, timestamped, marked].some(rows => rows.length > admissionReadLimit) || sources.length > 50) {
    unverifiedReason = "occupancy_read_bound_exceeded";
  }
  if (sources.some(source => source.bookingCount > 0)) unverifiedReason ??= "legacy_bookings_unreconciled";
  let insideCount = 0;
  for (const admission of admissions) {
    try { insideCount += remainingAdmissionParty(admission); }
    catch { unverifiedReason ??= "invalid_admission_record"; }
  }
  // Old check-in history is never silently treated as a departure. Its status
  // may have been cancelled/refunded/restored since it was admitted.
  const oldBookings = new Map([...timestamped, ...marked].map(booking => [booking.bookingRef, booking]));
  for (const booking of oldBookings.values()) {
    const admission = await bookingAdmission(ctx, booking.bookingRef);
    if (!admission) unverifiedReason ??= "legacy_checkin_needs_reconciliation";
    else {
      try { remainingAdmissionParty(admission); }
      catch { unverifiedReason ??= "invalid_admission_record"; }
    }
  }
  return { insideCount, capacity: venueCapacity, remaining: Math.max(0, venueCapacity - insideCount), unverifiedReason, admissions };
}
