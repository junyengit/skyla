import { describe, expect, it } from "vitest";

import { defaultHours } from "./lib/adminConfig";
import {
  assertCheckoutTimeAvailable,
  isCheckoutTimeAvailable,
  operatingWeekdayForDate,
  safeOperatingHours
} from "./lib/operatingHours";

describe("server-authoritative operating hours", () => {
  it("maps real calendar dates to weekdays without server timezone drift", () => {
    expect(operatingWeekdayForDate("2026-07-13")).toBe("Monday");
    expect(operatingWeekdayForDate("2026-02-31")).toBeNull();
  });

  it("supports same-day and overnight windows", () => {
    const hours = {
      ...defaultHours,
      Monday: { open: "10:00", close: "18:00", closed: false },
      Tuesday: { open: "18:00", close: "02:00", closed: false }
    };
    expect(isCheckoutTimeAvailable(hours, "2026-07-13", "10:00")).toBe(true);
    expect(isCheckoutTimeAvailable(hours, "2026-07-13", "18:00")).toBe(false);
    expect(isCheckoutTimeAvailable(hours, "2026-07-14", "23:00")).toBe(true);
    expect(isCheckoutTimeAvailable(hours, "2026-07-14", "01:00")).toBe(true);
    expect(isCheckoutTimeAvailable(hours, "2026-07-14", "12:00")).toBe(false);
  });

  it("rejects closed-day checkout and fails to safe defaults for invalid stored config", () => {
    const hours = { ...defaultHours, Monday: { open: "09:00", close: "00:00", closed: true } };
    expect(() => assertCheckoutTimeAvailable(hours, "2026-07-13", "14:00")).toThrow(
      "outside the configured operating hours"
    );
    expect(safeOperatingHours({ Monday: "invalid" })).toEqual(defaultHours);
  });
});
