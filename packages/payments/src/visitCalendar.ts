import { checkoutBookingWindowDays, checkoutEntryTimes } from "./order";

// Shared America/Los_Angeles visit-calendar rules. Every date here is a venue
// calendar date (YYYY-MM-DD) and every time is LA wall-clock minutes from that
// date's midnight. Nothing reads the device time zone or locale, parses an
// implicit-local date, or assumes a fixed UTC offset, so DST changes and UTC
// midnight cannot move a ticket onto another LA day.

export const venueTimeZone = "America/Los_Angeles" as const;
export const venueDayMinutes = 24 * 60;
export const visitWeekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export type VisitWeekday = (typeof visitWeekdays)[number];
export type VisitHoursDay = { open: string; close: string; closed: boolean };
export type VisitHours = Record<VisitWeekday, VisitHoursDay>;
export type VenueClock = { date: string; minutes: number };
export type VenueDaySegment = { openMinutes: number; closeMinutes: number };
export type VisitEntitlementWindow = { startMinutes: number; endMinutes: number };
export type VisitSlotUnavailableReason =
  | "invalid_date"
  | "invalid_time"
  | "past_date"
  | "beyond_horizon"
  | "closed_day"
  | "outside_hours"
  | "past_time";

const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;
const offeredEntryTimes = new Set<string>(checkoutEntryTimes.map((slot) => slot.value));
const venueClockFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: venueTimeZone,
  hourCycle: "h23",
  numberingSystem: "latn",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});
const visitDateLabelFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric"
});

function dateParts(value: string) {
  const match = datePattern.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day, utc };
}

/** Returns the date when it is a real YYYY-MM-DD calendar date, otherwise null. */
export function parseVisitDate(value: unknown): string | null {
  return typeof value === "string" && dateParts(value) ? value : null;
}

/** Returns the time when it is HH:mm on a 24-hour clock, otherwise null. */
export function parseVisitTime(value: unknown): string | null {
  return typeof value === "string" && timePattern.test(value) ? value : null;
}

export function visitTimeMinutes(value: string): number | null {
  const match = timePattern.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function isOfferedEntryTime(value: string) {
  return offeredEntryTimes.has(value);
}

/** The LA calendar date and wall-clock minute at an absolute instant. */
export function venueClock(timestamp: number): VenueClock {
  if (!Number.isFinite(timestamp)) {
    throw new Error("timestamp must be a finite number");
  }
  const parts = Object.fromEntries(
    venueClockFormat.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value])
  );
  const hour = Number(parts.hour) % 24;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + Number(parts.minute)
  };
}

export function venueToday(timestamp: number) {
  return venueClock(timestamp).date;
}

/** Pure calendar arithmetic; no time zone is involved. */
export function addVisitDays(visitDate: string, days: number) {
  const parts = dateParts(visitDate);
  if (!parts || !Number.isSafeInteger(days)) {
    throw new Error("visitDate must be a real YYYY-MM-DD date");
  }
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days)).toISOString().slice(0, 10);
}

export function visitWeekdayForDate(visitDate: string): VisitWeekday | null {
  const parts = dateParts(visitDate);
  return parts ? visitWeekdays[(parts.utc.getUTCDay() + 6) % 7] : null;
}

/** Short label such as "Sat, Oct 3" for a calendar date, independent of device zone. */
export function formatVisitDateLabel(visitDate: string) {
  const parts = dateParts(visitDate);
  return parts ? visitDateLabelFormat.format(parts.utc) : visitDate;
}

/**
 * Entry segments for one LA calendar date under that weekday's configured
 * hours. open === close keeps the existing all-day meaning. An overnight
 * configuration keeps its existing same-date entries (before close and from
 * open), but every segment ends no later than this date's midnight, so a
 * ticket can never extend onto the next LA date.
 */
export function venueDaySegments(hours: VisitHours, visitDate: string): VenueDaySegment[] {
  const weekday = visitWeekdayForDate(visitDate);
  if (!weekday) return [];
  const day = hours[weekday];
  if (!day || day.closed) return [];
  const open = visitTimeMinutes(day.open);
  const close = visitTimeMinutes(day.close);
  if (open === null || close === null) return [];
  if (open === close) return [{ openMinutes: 0, closeMinutes: venueDayMinutes }];
  if (open < close) return [{ openMinutes: open, closeMinutes: close }];
  return [
    ...(close > 0 ? [{ openMinutes: 0, closeMinutes: close }] : []),
    { openMinutes: open, closeMinutes: venueDayMinutes }
  ];
}

/**
 * The span a party holds its places for: from the chosen entry time through
 * the closing of the segment it enters. There is no guessed visit duration;
 * only a recorded departure can end the span earlier.
 */
export function visitEntitlementWindow(
  hours: VisitHours,
  visitDate: string,
  entryTime: string
): VisitEntitlementWindow | null {
  const entry = visitTimeMinutes(entryTime);
  if (entry === null) return null;
  const segment = venueDaySegments(hours, visitDate).find(
    (candidate) => entry >= candidate.openMinutes && entry < candidate.closeMinutes
  );
  return segment ? { startMinutes: entry, endMinutes: segment.closeMinutes } : null;
}

export function isEntryWithinHours(hours: VisitHours, visitDate: string, entryTime: string) {
  return visitEntitlementWindow(hours, visitDate, entryTime) !== null;
}

/**
 * Why a guest cannot buy entry at this slot right now, or null when the slot
 * is bookable. This is the purchase-time gate only; paid fulfillment must not
 * reuse the past-slot rule because a late webhook still fulfills that day.
 */
export function visitSlotUnavailableReason(
  hours: VisitHours,
  visitDate: unknown,
  entryTime: unknown,
  now: number
): VisitSlotUnavailableReason | null {
  const date = parseVisitDate(visitDate);
  if (!date) return "invalid_date";
  const clock = venueClock(now);
  if (date < clock.date) return "past_date";
  if (date > addVisitDays(clock.date, checkoutBookingWindowDays)) return "beyond_horizon";
  const time = parseVisitTime(entryTime);
  if (!time || !isOfferedEntryTime(time)) return "invalid_time";
  if (venueDaySegments(hours, date).length === 0) return "closed_day";
  if (!isEntryWithinHours(hours, date, time)) return "outside_hours";
  if (date === clock.date && (visitTimeMinutes(time) ?? 0) < clock.minutes) return "past_time";
  return null;
}

export const visitUnavailablePrefix = "Visit unavailable:";

const visitSlotMessages: Record<VisitSlotUnavailableReason, string> = {
  invalid_date: "visitDate must be a real YYYY-MM-DD date",
  invalid_time: "entryTime must be one of the offered HH:mm entry times",
  past_date: `${visitUnavailablePrefix} that date has already passed in Los Angeles`,
  beyond_horizon: `${visitUnavailablePrefix} that date is more than ${checkoutBookingWindowDays} days ahead`,
  closed_day: `${visitUnavailablePrefix} that entry time is outside the configured operating hours for that date`,
  outside_hours: `${visitUnavailablePrefix} that entry time is outside the configured operating hours for that date`,
  past_time: `${visitUnavailablePrefix} that entry time has already passed today in Los Angeles`
};

export function visitSlotUnavailableMessage(reason: VisitSlotUnavailableReason) {
  return visitSlotMessages[reason];
}

export function assertBookableVisitSlot(hours: VisitHours, visitDate: unknown, entryTime: unknown, now: number) {
  const reason = visitSlotUnavailableReason(hours, visitDate, entryTime, now);
  if (reason) {
    throw new Error(visitSlotUnavailableMessage(reason));
  }
  return { visitDate: visitDate as string, entryTime: entryTime as string };
}
