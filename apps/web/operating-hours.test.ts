import { describe, expect, it } from "vitest";

import {
  formatOperatingDay,
  isCheckoutEntryTimeAvailable,
  operatingWeekdayForDate,
  parsePublicOperatingConfig,
  type OperatingHours
} from "./lib/operating-hours";

const hours: OperatingHours = {
  Monday: { open: "11:00", close: "19:00", closed: false },
  Tuesday: { open: "17:00", close: "00:00", closed: false },
  Wednesday: { open: "17:00", close: "02:00", closed: false },
  Thursday: { open: "00:00", close: "00:00", closed: true },
  Friday: { open: "11:00", close: "21:00", closed: false },
  Saturday: { open: "10:00", close: "21:00", closed: false },
  Sunday: { open: "10:00", close: "18:00", closed: false }
};

describe("operating hour rules", () => {
  it("maps ISO dates to weekdays without depending on the runtime timezone", () => {
    expect(operatingWeekdayForDate("2026-07-13")).toBe("Monday");
    expect(operatingWeekdayForDate("2026-07-19")).toBe("Sunday");
    expect(operatingWeekdayForDate("2026-02-30")).toBeNull();
  });

  it("accepts only entry times inside same-day and overnight windows", () => {
    expect(isCheckoutEntryTimeAvailable(hours, "2026-07-13", "11:00")).toBe(true);
    expect(isCheckoutEntryTimeAvailable(hours, "2026-07-13", "19:00")).toBe(false);
    expect(isCheckoutEntryTimeAvailable(hours, "2026-07-14", "18:30")).toBe(true);
    expect(isCheckoutEntryTimeAvailable(hours, "2026-07-14", "00:00")).toBe(false);
    expect(isCheckoutEntryTimeAvailable(hours, "2026-07-15", "01:00")).toBe(true);
    expect(isCheckoutEntryTimeAvailable(hours, "2026-07-16", "12:30")).toBe(false);
  });

  it("formats operating windows for guest copy", () => {
    expect(formatOperatingDay(hours.Monday)).toBe("11:00 AM - 7:00 PM");
    expect(formatOperatingDay(hours.Tuesday)).toBe("5:00 PM - midnight");
    expect(formatOperatingDay(hours.Thursday)).toBe("Closed");
  });

  it("rejects malformed server projections instead of trusting their shape", () => {
    expect(
      parsePublicOperatingConfig({
        announcement: null,
        operatingHours: hours,
        timeZone: "America/Los_Angeles"
      })
    ).toEqual({
      announcement: null,
      operatingHours: hours,
      timeZone: "America/Los_Angeles"
    });
    expect(
      parsePublicOperatingConfig({
        announcement: null,
        operatingHours: { ...hours, Friday: { open: "9:00", close: "21:00", closed: false } },
        timeZone: "America/Los_Angeles"
      })
    ).toBeNull();
  });
});
