import { venueCapacity } from "@skyla/payments";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export const admissionReadLimit = 500;
type Ctx = MutationCtx | QueryCtx;
type AdmissionDoc = Doc<"bookingAdmissions">;

export function remainingAdmissionParty(admission: Pick<AdmissionDoc, "partySize" | "departedCount" | "inside">) {
  if (!Number.isSafeInteger(admission.partySize) || admission.partySize < 1 || admission.partySize > venueCapacity ||
      !Number.isSafeInteger(admission.departedCount) || admission.departedCount < 0 || admission.departedCount > admission.partySize ||
      admission.inside !== (admission.departedCount < admission.partySize)) {
    throw new Error("Admission blocked: occupancy record needs reconciliation");
  }
  return admission.partySize - admission.departedCount;
}

export type BookingAdmissionLookup =
  | { kind: "none" }
  | { kind: "one"; admission: AdmissionDoc }
  /** More than one ledger row: the party was admitted, but its record is ambiguous. */
  | { kind: "duplicate" };

/** Bounded, classified lookup of a booking's admission ledger; never throws on duplicates. */
export async function lookupBookingAdmission(ctx: Ctx, bookingRef: string): Promise<BookingAdmissionLookup> {
  const rows = await ctx.db.query("bookingAdmissions").withIndex("by_bookingRef", q => q.eq("bookingRef", bookingRef)).take(2);
  if (rows.length > 1) return { kind: "duplicate" };
  return rows[0] ? { kind: "one", admission: rows[0] } : { kind: "none" };
}

/** The one admission row, or null. A duplicated ledger blocks the caller explicitly. */
export async function bookingAdmission(ctx: Ctx, bookingRef: string) {
  const lookup = await lookupBookingAdmission(ctx, bookingRef);
  if (lookup.kind === "duplicate") throw new Error("Admission blocked: occupancy record needs reconciliation");
  return lookup.kind === "one" ? lookup.admission : null;
}

/**
 * Physical presence survives billing changes, expiry and LA midnight. A
 * duplicated or malformed ledger marks occupancy unverified; an admitted party
 * with two inside rows is counted once (its larger remainder), never twice
 * and never dropped.
 */
export async function loadPhysicalOccupancy(ctx: Ctx) {
  const [insideRows, timestamped, marked, sources] = await Promise.all([
    ctx.db.query("bookingAdmissions").withIndex("by_inside", q => q.eq("inside", true)).take(admissionReadLimit + 1),
    ctx.db.query("bookings").withIndex("by_admissionTracked_checkedInAt", q => q.eq("admissionTracked", undefined).gte("checkedInAt", 0)).take(admissionReadLimit + 1),
    ctx.db.query("bookings").withIndex("by_admissionTracked_status", q => q.eq("admissionTracked", undefined).eq("status", "checked-in")).take(admissionReadLimit + 1),
    ctx.db.query("legacyMigrationSources").take(51)
  ]);
  let unverifiedReason: string | undefined;
  const mark = (reason: string) => { unverifiedReason ??= reason; };
  if ([insideRows, timestamped, marked].some(rows => rows.length > admissionReadLimit) || sources.length > 50) {
    mark("occupancy_read_bound_exceeded");
  }
  if (sources.some(source => source.bookingCount > 0)) mark("legacy_bookings_unreconciled");

  const byBooking = new Map<string, AdmissionDoc>();
  const remainder = (row: AdmissionDoc) => row.partySize - row.departedCount;
  for (const admission of insideRows) {
    const previous = byBooking.get(admission.bookingRef);
    if (previous) {
      mark("admission_duplicate");
      if (remainder(admission) > remainder(previous)) byBooking.set(admission.bookingRef, admission);
    } else {
      byBooking.set(admission.bookingRef, admission);
    }
  }
  const admissions = [...byBooking.values()];
  let insideCount = 0;
  for (const admission of admissions) {
    // An inside row with a departed twin is still one ambiguous party.
    if ((await lookupBookingAdmission(ctx, admission.bookingRef)).kind === "duplicate") mark("admission_duplicate");
    try { insideCount += remainingAdmissionParty(admission); }
    catch { mark("invalid_admission_record"); }
  }
  // Old check-in history is never silently treated as a departure. Its status
  // may have been cancelled/refunded/restored since it was admitted.
  const oldBookings = new Map([...timestamped, ...marked].map(booking => [booking.bookingRef, booking]));
  for (const booking of oldBookings.values()) {
    const lookup = await lookupBookingAdmission(ctx, booking.bookingRef);
    if (lookup.kind === "duplicate") mark("admission_duplicate");
    else if (lookup.kind === "none") mark("legacy_checkin_needs_reconciliation");
    else {
      try { remainingAdmissionParty(lookup.admission); }
      catch { mark("invalid_admission_record"); }
    }
  }
  return { insideCount, capacity: venueCapacity, remaining: Math.max(0, venueCapacity - insideCount), unverifiedReason, admissions };
}
