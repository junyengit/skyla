import {
  admissionMaxPartySize,
  checkoutEntryTimes,
  parseVisitDate,
  venueCapacity,
  venueTimeZone,
  visitWeekdays,
  type VisitHoursDay,
  type VisitWeekday
} from "@skyla/payments";

export const visitSlotStatuses = ["available", "full", "past", "closed", "private_event", "unverified"] as const;
export const visitDayStatuses = [
  "open",
  "full",
  "past",
  "closed",
  "beyond_horizon",
  "private_event",
  "unverified"
] as const;

export type VisitSlotStatus = (typeof visitSlotStatuses)[number];
export type VisitDayStatus = (typeof visitDayStatuses)[number];
export type VisitAvailabilitySlot = { entryTime: string; status: VisitSlotStatus; remaining: number };
export type VisitAvailability = {
  visitDate: string;
  timeZone: typeof venueTimeZone;
  today: string;
  weekday: VisitWeekday;
  capacity: number;
  partySize: number;
  dayStatus: VisitDayStatus;
  dayHours: VisitHoursDay;
  slots: VisitAvailabilitySlot[];
};

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const offeredEntryTimes = checkoutEntryTimes.map((slot) => slot.value as string);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function placeCount(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= venueCapacity
    ? value
    : null;
}

export function parseVisitPartySize(value: unknown) {
  const count = typeof value === "string" && /^\d{1,2}$/.test(value) ? Number(value) : value;
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 1 && count <= admissionMaxPartySize
    ? count
    : null;
}

/**
 * Validates the anonymous availability projection field by field and copies
 * only known fields, so nothing unexpected from the server reaches the page.
 */
export function parseVisitAvailability(value: unknown): VisitAvailability | null {
  const body = record(value);
  const hours = record(body?.dayHours);
  if (
    !body ||
    !hours ||
    !parseVisitDate(body.visitDate) ||
    !parseVisitDate(body.today) ||
    body.timeZone !== venueTimeZone ||
    !visitWeekdays.includes(body.weekday as VisitWeekday) ||
    body.capacity !== venueCapacity ||
    parseVisitPartySize(body.partySize) === null ||
    !visitDayStatuses.includes(body.dayStatus as VisitDayStatus) ||
    typeof hours.open !== "string" ||
    !timePattern.test(hours.open) ||
    typeof hours.close !== "string" ||
    !timePattern.test(hours.close) ||
    typeof hours.closed !== "boolean" ||
    !Array.isArray(body.slots) ||
    body.slots.length !== offeredEntryTimes.length
  ) {
    return null;
  }

  const slots: VisitAvailabilitySlot[] = [];
  for (const [index, item] of body.slots.entries()) {
    const slot = record(item);
    const remaining = placeCount(slot?.remaining);
    if (
      !slot ||
      slot.entryTime !== offeredEntryTimes[index] ||
      !visitSlotStatuses.includes(slot.status as VisitSlotStatus) ||
      remaining === null
    ) {
      return null;
    }
    slots.push({ entryTime: slot.entryTime as string, status: slot.status as VisitSlotStatus, remaining });
  }

  return {
    visitDate: body.visitDate as string,
    timeZone: venueTimeZone,
    today: body.today as string,
    weekday: body.weekday as VisitWeekday,
    capacity: venueCapacity,
    partySize: body.partySize as number,
    dayStatus: body.dayStatus as VisitDayStatus,
    dayHours: { open: hours.open, close: hours.close, closed: hours.closed },
    slots
  };
}
