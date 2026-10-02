import {
  checkoutEntryTimes,
  venueCapacity,
  venueClock,
  venueDayMinutes,
  venueDaySegments,
  venueTimeZone,
  visitEntitlementWindow,
  visitSlotUnavailableReason,
  visitTimeMinutes,
  visitUnavailablePrefix,
  visitWeekdayForDate,
  type VisitEntitlementWindow,
  type VisitHours,
  type VisitHoursDay
} from "@skyla/payments";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { safeOperatingHours } from "./operatingHours";
import { bookingAdmission, loadPhysicalOccupancy, remainingAdmissionParty } from "./occupancy";

export const activeCapacityStatuses = ["draft", "payment_pending", "paid", "exception"] as const;
export type ActiveCapacityStatus = (typeof activeCapacityStatuses)[number];
// Bounded per-date reads. Capacity keeps real dates far below this; reaching it
// means the data cannot be trusted, so availability fails closed.
export const capacityReadLimit = 500;
const legacySourceReadLimit = 50;
const countedBookingStatuses = ["confirmed", "checked-in"] as const;
export const legacyUnreconciledReason = "legacy_bookings_unreconciled";

export type OccupancyInterval = { startMinutes: number; endMinutes: number; partySize: number };
export type DateOccupancy = {
  privateEvent: boolean;
  /** Set when stored records cannot be placed on this date with certainty. */
  unverifiedReason?: string;
  intervals: OccupancyInterval[];
};
export type CapacityDecision =
  | { ok: true; window: VisitEntitlementWindow; remaining: number }
  | { ok: false; reason: "private_event" | "unverified" | "insufficient" | "outside_hours"; message: string; remaining: number };

type CapacityCtx = QueryCtx | MutationCtx;
type ReservationDoc = Doc<"capacityReservations">;

/** Largest number of people inside at any moment in [from, to). */
export function peakOccupancy(intervals: readonly OccupancyInterval[], fromMinutes: number, toMinutes: number) {
  const points = new Set([fromMinutes]);
  for (const interval of intervals) {
    if (interval.startMinutes > fromMinutes && interval.startMinutes < toMinutes) {
      points.add(interval.startMinutes);
    }
  }
  let peak = 0;
  for (const point of points) {
    let inside = 0;
    for (const interval of intervals) {
      if (interval.startMinutes <= point && point < interval.endMinutes) inside += interval.partySize;
    }
    peak = Math.max(peak, inside);
  }
  return peak;
}

export function remainingPlaces(intervals: readonly OccupancyInterval[], window: VisitEntitlementWindow) {
  return Math.max(0, venueCapacity - peakOccupancy(intervals, window.startMinutes, window.endMinutes));
}

/** A held/paid party's span, shortened only by a recorded departure. */
export function reservationInterval(
  reservation: Pick<ReservationDoc, "visitDate" | "startMinutes" | "endMinutes" | "partySize" | "departedAt" | "departedCount">
): OccupancyInterval | null {
  let endMinutes = reservation.endMinutes;
  if (reservation.departedAt !== undefined) {
    const departure = venueClock(reservation.departedAt);
    if (departure.date < reservation.visitDate) endMinutes = reservation.startMinutes;
    else if (departure.date === reservation.visitDate) endMinutes = Math.min(endMinutes, departure.minutes);
  }
  const partySize = reservation.partySize - (reservation.departedCount ?? 0);
  if (!Number.isSafeInteger(partySize) || partySize < 0 || partySize > reservation.partySize) throw new Error("Stored capacity departure needs reconciliation");
  if (endMinutes <= reservation.startMinutes || partySize === 0) return null;
  return { startMinutes: reservation.startMinutes, endMinutes, partySize };
}

/**
 * Conservative span for a committed booking that predates reservation rows:
 * from its entry (or the start of the day when unknown) through closing.
 * Returns null when its party size is unknown, which makes the date unverified.
 */
export function legacyBookingInterval(
  booking: Pick<Doc<"bookings">, "visitDate" | "entryTime" | "partySize">,
  hours: VisitHours
): OccupancyInterval | null {
  const partySize = booking.partySize;
  if (typeof partySize !== "number" || !Number.isSafeInteger(partySize) || partySize < 1 || partySize > 10_000) {
    return null;
  }
  const entry = booking.entryTime ? visitTimeMinutes(booking.entryTime) : null;
  const window = booking.visitDate && booking.entryTime
    ? visitEntitlementWindow(hours, booking.visitDate, booking.entryTime)
    : null;
  return window
    ? { ...window, partySize }
    : { startMinutes: entry ?? 0, endMinutes: venueDayMinutes, partySize };
}

export async function loadVenueHours(ctx: CapacityCtx): Promise<VisitHours> {
  const hoursRow = await ctx.db
    .query("config")
    .withIndex("by_key", (q) => q.eq("key", "hours"))
    .unique();
  return safeOperatingHours(hoursRow?.data);
}

/**
 * Everything that occupies the venue on one LA date, read through bounded
 * indexed queries: confirmed private events, active reservation holds, and
 * committed bookings without a reservation row (POS, earlier checkout). Unknown
 * party sizes, unknown booking states, unreconciled legacy imports, or a read
 * that hits the bound mark the date unverified instead of offering space.
 */
export async function loadDateOccupancy(ctx: CapacityCtx, visitDate: string, hours: VisitHours): Promise<DateOccupancy> {
  const [privateEvent, reservationGroups, bookingGroups, unknownStatuses, undatedConfirmed, undatedCheckedIn, legacySources] =
    await Promise.all([
      ctx.db
        .query("privateEvents")
        .withIndex("by_visitDate_status", (q) => q.eq("visitDate", visitDate).eq("status", "confirmed"))
        .first(),
      Promise.all(
        activeCapacityStatuses.map((status) =>
          ctx.db
            .query("capacityReservations")
            .withIndex("by_visitDate_status_departedAt", (q) => q.eq("visitDate", visitDate).eq("status", status).eq("departedAt", undefined))
            .take(capacityReadLimit + 1)
        )
      ),
      Promise.all(countedBookingStatuses.map(status => ctx.db.query("bookings")
        .withIndex("by_visitDate_status_departedAt", q => q.eq("visitDate", visitDate).eq("status", status).eq("departedAt", undefined))
        .take(capacityReadLimit + 1))),
      // Unknown free-text legacy statuses cannot imply a safe departure.
      // Four index ranges skip known history without an unbounded filter scan.
      Promise.all([
        ctx.db.query("bookings").withIndex("by_visitDate_status", q => q.eq("visitDate", visitDate).lt("status", "cancelled")).first(),
        ctx.db.query("bookings").withIndex("by_visitDate_status", q => q.eq("visitDate", visitDate).gt("status", "cancelled").lt("status", "checked-in")).first(),
        ctx.db.query("bookings").withIndex("by_visitDate_status", q => q.eq("visitDate", visitDate).gt("status", "checked-in").lt("status", "confirmed")).first(),
        ctx.db.query("bookings").withIndex("by_visitDate_status", q => q.eq("visitDate", visitDate).gt("status", "confirmed")).first()
      ]),
      ctx.db
        .query("bookings")
        .withIndex("by_visitDate_status_departedAt", (q) => q.eq("visitDate", undefined).eq("status", "confirmed").eq("departedAt", undefined))
        .first(),
      ctx.db
        .query("bookings")
        .withIndex("by_visitDate_status_departedAt", (q) => q.eq("visitDate", undefined).eq("status", "checked-in").eq("departedAt", undefined))
        .first(),
      ctx.db.query("legacyMigrationSources").take(legacySourceReadLimit + 1)
    ]);

  // Known spans are always collected (private-event conflict checks use them);
  // any uncertainty additionally marks the date unverified for sales.
  const occupancy: DateOccupancy = { privateEvent: Boolean(privateEvent), intervals: [] };
  const markUnverified = (reason: string) => {
    occupancy.unverifiedReason ??= reason;
  };

  const bookings = bookingGroups.flat();
  if (reservationGroups.some((group) => group.length > capacityReadLimit) || bookingGroups.some(group => group.length > capacityReadLimit)) {
    markUnverified("read_bound_exceeded");
  }
  if (unknownStatuses.some(Boolean)) markUnverified("unknown_booking_status");
  if (undatedConfirmed || undatedCheckedIn) {
    markUnverified("undated_committed_booking");
  }
  // Imported legacy bookings carry free-text dates and party sizes that cannot
  // be placed on an LA date reliably; recovery/import must reconcile them
  // before online sales can trust any date.
  if (legacySources.length > legacySourceReadLimit || legacySources.some((source) => source.bookingCount > 0)) {
    markUnverified(legacyUnreconciledReason);
  }

  const physical = await loadPhysicalOccupancy(ctx);
  if (physical.unverifiedReason) markUnverified(physical.unverifiedReason);
  const physicalOrderRefs = new Set<string>();
  for (const admission of physical.admissions) {
    if (admission.visitDate > visitDate) continue;
    const booking = await ctx.db.query("bookings").withIndex("by_bookingRef", q => q.eq("bookingRef", admission.bookingRef)).unique();
    if (booking?.orderRef) physicalOrderRefs.add(booking.orderRef);
  }

  const reservedOrderRefs = new Set<string>();
  for (const reservation of reservationGroups.flat()) {
    reservedOrderRefs.add(reservation.orderRef);
    // An admitted party is counted from physical presence below, even after
    // cancellation or a closing break. Its paid hold is the same party.
    if (physicalOrderRefs.has(reservation.orderRef)) continue;
    const interval = reservationInterval(reservation);
    if (interval) occupancy.intervals.push(interval);
  }

  for (const booking of bookings) {
    if (booking.orderRef && reservedOrderRefs.has(booking.orderRef)) continue;
    const admission = await bookingAdmission(ctx, booking.bookingRef);
    if (admission) {
      try { remainingAdmissionParty(admission); }
      catch { markUnverified("invalid_admission_record"); }
      continue;
    }
    const interval = legacyBookingInterval(booking, hours);
    if (!interval) {
      markUnverified("unknown_party_size");
      continue;
    }
    occupancy.intervals.push(interval);
  }

  // A previous-day guest still inside does not disappear at midnight. A
  // cancelled/refunded same-day party also remains in physical occupancy.
  for (const admission of physical.admissions) {
    if (admission.visitDate <= visitDate) {
      try { occupancy.intervals.push({ startMinutes: 0, endMinutes: venueDayMinutes, partySize: remainingAdmissionParty(admission) }); }
      catch { markUnverified("invalid_admission_record"); }
    }
  }

  return occupancy;
}

export function occupiedPlaces(occupancy: DateOccupancy) {
  return occupancy.intervals.reduce((total, interval) => total + interval.partySize, 0);
}

export function decideCapacity(
  occupancy: DateOccupancy,
  hours: VisitHours,
  visit: { visitDate: string; entryTime: string; partySize: number }
): CapacityDecision {
  const window = visitEntitlementWindow(hours, visit.visitDate, visit.entryTime);
  if (!window) {
    return {
      ok: false,
      reason: "outside_hours",
      remaining: 0,
      message: `${visitUnavailablePrefix} that entry time is outside the configured operating hours for that date`
    };
  }
  if (occupancy.privateEvent) {
    return {
      ok: false,
      reason: "private_event",
      remaining: 0,
      message: `${visitUnavailablePrefix} that date is reserved for a private event`
    };
  }
  if (occupancy.unverifiedReason) {
    return {
      ok: false,
      reason: "unverified",
      remaining: 0,
      message: `${visitUnavailablePrefix} online availability cannot be confirmed for that date`
    };
  }
  const remaining = remainingPlaces(occupancy.intervals, window);
  if (remaining < visit.partySize) {
    return {
      ok: false,
      reason: "insufficient",
      remaining,
      message: `${visitUnavailablePrefix} ${remaining === 0 ? "no places remain" : `only ${remaining} of ${venueCapacity} places remain`} for that entry time`
    };
  }
  return { ok: true, window, remaining };
}

export function ticketPartySize(lines: ReadonlyArray<{ kind: string; quantity: number }>) {
  return lines.reduce(
    (total, line) => (line.kind === "ticket" && Number.isInteger(line.quantity) && line.quantity > 0 ? total + line.quantity : total),
    0
  );
}

export async function findCapacityReservation(ctx: CapacityCtx, orderRef: string) {
  return ctx.db
    .query("capacityReservations")
    .withIndex("by_orderRef", (q) => q.eq("orderRef", orderRef))
    .unique();
}

/** Checks capacity and inserts the hold in the caller's transaction. */
export async function placeCapacityHold(
  ctx: MutationCtx,
  args: {
    orderRef: string;
    visitDate: string;
    entryTime: string;
    partySize: number;
    status: "draft" | "payment_pending";
    hours: VisitHours;
    now: number;
  }
): Promise<Id<"capacityReservations">> {
  const occupancy = await loadDateOccupancy(ctx, args.visitDate, args.hours);
  const decision = decideCapacity(occupancy, args.hours, args);
  if (!decision.ok) {
    throw new Error(decision.message);
  }
  return ctx.db.insert("capacityReservations", {
    orderRef: args.orderRef,
    visitDate: args.visitDate,
    entryTime: args.entryTime,
    startMinutes: decision.window.startMinutes,
    endMinutes: decision.window.endMinutes,
    partySize: args.partySize,
    status: args.status,
    ...(args.status === "payment_pending" ? { paymentPendingAt: args.now } : {}),
    createdAt: args.now,
    updatedAt: args.now
  });
}

/** Releases an unpaid hold. Paid and exception holds are never released here. */
export async function releaseUnpaidCapacityHold(ctx: MutationCtx, orderRef: string, reason: string, now: number) {
  const reservation = await findCapacityReservation(ctx, orderRef);
  if (!reservation || (reservation.status !== "draft" && reservation.status !== "payment_pending")) {
    return { released: false, status: reservation?.status };
  }
  await ctx.db.patch(reservation._id, {
    status: "released",
    releasedAt: now,
    releaseReason: reason,
    updatedAt: now
  });
  return { released: true, status: "released" as const };
}

export type PaidCapacitySettlement =
  | { kind: "paid"; reservationId: Id<"capacityReservations">; acquiredAtFulfillment: boolean }
  | { kind: "exception"; reservationId: Id<"capacityReservations">; reason: string };

/**
 * Converts an order's hold to paid inside the paid-booking transaction. An
 * older order without a usable hold reserves now only if capacity allows;
 * otherwise it becomes a counted exception so the venue is never oversold.
 * Never applies the purchase-time past-slot rule: a late paid webhook still
 * fulfills a same-day ticket.
 */
export async function settlePaidCapacity(
  ctx: MutationCtx,
  args: {
    orderRef: string;
    bookingRef: string;
    visitDate: string;
    entryTime: string;
    partySize: number;
    /** A committed booking already counts this party; record it without re-checking. */
    alreadyCommitted?: boolean;
    now: number;
  }
): Promise<PaidCapacitySettlement> {
  const reservation = await findCapacityReservation(ctx, args.orderRef);
  if (reservation && (reservation.visitDate !== args.visitDate || reservation.entryTime !== args.entryTime || reservation.partySize !== args.partySize)) {
    throw new Error("Stored capacity reservation does not match paid order fulfillment");
  }
  if (reservation?.status === "paid") {
    return { kind: "paid", reservationId: reservation._id, acquiredAtFulfillment: false };
  }
  if (reservation?.status === "exception") {
    return { kind: "exception", reservationId: reservation._id, reason: reservation.exceptionReason ?? "capacity_exception" };
  }
  if (reservation && (reservation.status === "draft" || reservation.status === "payment_pending")) {
    await ctx.db.patch(reservation._id, {
      status: "paid",
      bookingRef: args.bookingRef,
      paidAt: args.now,
      updatedAt: args.now
    });
    return { kind: "paid", reservationId: reservation._id, acquiredAtFulfillment: false };
  }

  const hours = await loadVenueHours(ctx);
  const conservativeWindow = visitEntitlementWindow(hours, args.visitDate, args.entryTime) ?? {
    startMinutes: visitTimeMinutes(args.entryTime) ?? 0,
    endMinutes: venueDayMinutes
  };
  const decision: CapacityDecision = args.alreadyCommitted
    ? { ok: true, window: conservativeWindow, remaining: 0 }
    : decideCapacity(await loadDateOccupancy(ctx, args.visitDate, hours), hours, args);
  const window = decision.ok ? decision.window : conservativeWindow;
  const status = decision.ok ? ("paid" as const) : ("exception" as const);
  const exceptionReason = decision.ok ? undefined : `paid_without_capacity:${decision.reason}`;
  const fields = {
    startMinutes: window.startMinutes,
    endMinutes: window.endMinutes,
    status,
    ...(decision.ok ? { bookingRef: args.bookingRef, paidAt: args.now } : { exceptionReason }),
    updatedAt: args.now
  };

  let reservationId: Id<"capacityReservations">;
  if (reservation) {
    reservationId = reservation._id;
    await ctx.db.patch(reservation._id, fields);
  } else {
    reservationId = await ctx.db.insert("capacityReservations", {
      orderRef: args.orderRef,
      visitDate: args.visitDate,
      entryTime: args.entryTime,
      partySize: args.partySize,
      createdAt: args.now,
      ...fields
    });
  }
  return decision.ok
    ? { kind: "paid", reservationId, acquiredAtFulfillment: true }
    : { kind: "exception", reservationId, reason: exceptionReason! };
}

export type PublicSlotStatus = "available" | "full" | "past" | "closed" | "private_event" | "unverified";
export type PublicDayStatus = "open" | "full" | "past" | "closed" | "beyond_horizon" | "private_event" | "unverified";
export type PublicVisitAvailability = {
  visitDate: string;
  timeZone: typeof venueTimeZone;
  today: string;
  weekday: string;
  capacity: number;
  partySize: number;
  dayStatus: PublicDayStatus;
  dayHours: VisitHoursDay;
  slots: Array<{ entryTime: string; status: PublicSlotStatus; remaining: number }>;
};

/** Anonymous aggregate only: no refs, emails, ticket codes, or event labels. */
export function projectPublicVisitAvailability(args: {
  visitDate: string;
  partySize: number;
  hours: VisitHours;
  occupancy: DateOccupancy;
  now: number;
}): PublicVisitAvailability {
  const weekday = visitWeekdayForDate(args.visitDate)!;
  const today = venueClock(args.now).date;
  let dateReason: PublicDayStatus | undefined;

  const slots = checkoutEntryTimes.map(({ value: entryTime }) => {
    const slotReason = visitSlotUnavailableReason(args.hours, args.visitDate, entryTime, args.now);
    if (slotReason === "past_date" || slotReason === "past_time") {
      if (slotReason === "past_date") dateReason = "past";
      return { entryTime, status: "past" as const, remaining: 0 };
    }
    if (slotReason === "beyond_horizon") {
      dateReason = "beyond_horizon";
      return { entryTime, status: "closed" as const, remaining: 0 };
    }
    if (slotReason) return { entryTime, status: "closed" as const, remaining: 0 };
    const decision = decideCapacity(args.occupancy, args.hours, { visitDate: args.visitDate, entryTime, partySize: args.partySize });
    if (decision.ok) return { entryTime, status: "available" as const, remaining: decision.remaining };
    if (decision.reason === "private_event" || decision.reason === "unverified") {
      return { entryTime, status: decision.reason, remaining: 0 };
    }
    if (decision.reason === "insufficient") return { entryTime, status: "full" as const, remaining: decision.remaining };
    return { entryTime, status: "closed" as const, remaining: 0 };
  });

  const dayStatus: PublicDayStatus = dateReason
    ?? (venueDaySegments(args.hours, args.visitDate).length === 0
      ? "closed"
      : args.occupancy.privateEvent
        ? "private_event"
        : args.occupancy.unverifiedReason
          ? "unverified"
          : slots.some((slot) => slot.status === "available")
            ? "open"
            : slots.some((slot) => slot.status === "full")
              ? "full"
              : slots.some((slot) => slot.status === "past")
                ? "past"
                : "closed");

  return {
    visitDate: args.visitDate,
    timeZone: venueTimeZone,
    today,
    weekday,
    capacity: venueCapacity,
    partySize: args.partySize,
    dayStatus,
    dayHours: args.hours[weekday],
    slots
  };
}
