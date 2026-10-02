import { describe, expect, it } from "vitest";

import {
  addVisitDays,
  assertBookableVisitSlot,
  formatVisitDateLabel,
  parseVisitDate,
  venueClock,
  venueDaySegments,
  visitEntitlementWindow,
  visitSlotUnavailableReason,
  visitWeekdayForDate,
  type VisitHours
} from "./visitCalendar";

const hours: VisitHours = {
  Monday: { open: "09:00", close: "18:00", closed: false },
  Tuesday: { open: "18:00", close: "02:00", closed: false },
  Wednesday: { open: "09:00", close: "00:00", closed: false },
  Thursday: { open: "00:00", close: "00:00", closed: false },
  Friday: { open: "09:00", close: "18:00", closed: false },
  Saturday: { open: "10:00", close: "22:00", closed: false },
  Sunday: { open: "10:00", close: "22:00", closed: true }
};

describe("Los Angeles venue clock", () => {
  it("keeps the LA date across UTC midnight", () => {
    // 2026-10-03T06:30Z is still 11:30 PM on Friday October 2 in Los Angeles.
    expect(venueClock(Date.parse("2026-10-03T06:30:00.000Z"))).toEqual({ date: "2026-10-02", minutes: 23 * 60 + 30 });
    expect(venueClock(Date.parse("2026-10-03T07:00:00.000Z"))).toEqual({ date: "2026-10-03", minutes: 0 });
  });

  it("follows the November 1 DST fallback instead of a fixed offset", () => {
    expect(venueClock(Date.parse("2026-11-01T07:30:00.000Z"))).toEqual({ date: "2026-11-01", minutes: 30 });
    // 1:30 AM happens twice: first PDT, then PST an hour later.
    expect(venueClock(Date.parse("2026-11-01T08:30:00.000Z"))).toEqual({ date: "2026-11-01", minutes: 90 });
    expect(venueClock(Date.parse("2026-11-01T09:30:00.000Z"))).toEqual({ date: "2026-11-01", minutes: 90 });
    // A fixed UTC-7 guess would already call this November 2.
    expect(venueClock(Date.parse("2026-11-02T07:30:00.000Z"))).toEqual({ date: "2026-11-01", minutes: 23 * 60 + 30 });
    expect(venueClock(Date.parse("2026-11-02T08:00:00.000Z"))).toEqual({ date: "2026-11-02", minutes: 0 });
  });

  it("does calendar arithmetic and weekdays without a time zone", () => {
    expect(addVisitDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addVisitDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addVisitDays("2027-02-28", 365)).toBe("2028-02-28");
    expect(visitWeekdayForDate("2026-11-01")).toBe("Sunday");
    expect(formatVisitDateLabel("2026-11-01")).toBe("Sun, Nov 1");
    expect(parseVisitDate("2026-02-29")).toBeNull();
    expect(parseVisitDate("2026-10-3")).toBeNull();
    expect(parseVisitDate(20261003)).toBeNull();
  });
});

describe("visit day segments and entitlement", () => {
  it("keeps configured-hour semantics, including all-day and closing at midnight", () => {
    expect(venueDaySegments(hours, "2026-10-05")).toEqual([{ openMinutes: 540, closeMinutes: 1080 }]);
    expect(venueDaySegments(hours, "2026-10-08")).toEqual([{ openMinutes: 0, closeMinutes: 1440 }]);
    expect(venueDaySegments(hours, "2026-10-07")).toEqual([{ openMinutes: 540, closeMinutes: 1440 }]);
    expect(venueDaySegments(hours, "2026-10-04")).toEqual([]);
  });

  it("never lets an overnight configuration extend a ticket onto the next LA date", () => {
    // Tuesday 18:00-02:00: same-date entries stay valid, but every span ends by midnight.
    expect(venueDaySegments(hours, "2026-10-06")).toEqual([
      { openMinutes: 0, closeMinutes: 120 },
      { openMinutes: 1080, closeMinutes: 1440 }
    ]);
    expect(visitEntitlementWindow(hours, "2026-10-06", "20:30")).toEqual({ startMinutes: 1230, endMinutes: 1440 });
    expect(visitEntitlementWindow(hours, "2026-10-06", "01:00")).toEqual({ startMinutes: 60, endMinutes: 120 });
    expect(visitEntitlementWindow(hours, "2026-10-06", "12:00")).toBeNull();
  });

  it("holds a party's places from entry through closing with no guessed duration", () => {
    expect(visitEntitlementWindow(hours, "2026-10-03", "10:30")).toEqual({ startMinutes: 630, endMinutes: 1320 });
  });
});

describe("purchase-time slot gate", () => {
  // Friday 2026-10-02, 2:10 PM in Los Angeles.
  const now = Date.parse("2026-10-02T21:10:00.000Z");

  it.each([
    ["missing date", undefined, "14:30", "invalid_date"],
    ["impossible date", "2026-02-30", "14:30", "invalid_date"],
    ["past date", "2026-10-01", "14:30", "past_date"],
    ["beyond the booking horizon", "2027-10-03", "14:30", "beyond_horizon"],
    ["time not offered", "2026-10-05", "14:15", "invalid_time"],
    ["missing time", "2026-10-05", undefined, "invalid_time"],
    ["closed day", "2026-10-04", "14:00", "closed_day"],
    ["outside configured hours", "2026-10-05", "18:00", "outside_hours"],
    ["earlier slot today", "2026-10-02", "14:00", "past_time"]
  ])("rejects a %s", (_label, visitDate, entryTime, reason) => {
    expect(visitSlotUnavailableReason(hours, visitDate, entryTime, now)).toBe(reason);
  });

  it("accepts the next slot today and the last day of the horizon", () => {
    expect(visitSlotUnavailableReason(hours, "2026-10-02", "14:30", now)).toBeNull();
    expect(visitSlotUnavailableReason(hours, "2027-10-02", "14:30", now)).toBeNull();
  });

  it("uses the LA date at UTC midnight, not the UTC date", () => {
    // 2026-10-03T06:30Z is 11:30 PM Friday in LA: Saturday is still tomorrow.
    const lateFriday = Date.parse("2026-10-03T06:30:00.000Z");
    expect(visitSlotUnavailableReason(hours, "2026-10-02", "17:30", lateFriday)).toBe("past_time");
    expect(visitSlotUnavailableReason(hours, "2026-10-03", "10:00", lateFriday)).toBeNull();
  });

  it("throws user-facing visit messages for unavailable slots", () => {
    expect(() => assertBookableVisitSlot(hours, "2026-10-02", "14:00", now)).toThrow(
      "Visit unavailable: that entry time has already passed today in Los Angeles"
    );
    expect(() => assertBookableVisitSlot(hours, "2026-10-04", "14:00", now)).toThrow(
      "outside the configured operating hours"
    );
  });
});
