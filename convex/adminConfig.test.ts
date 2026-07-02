import { describe, expect, it } from "vitest";

import {
  configAuditMetadata,
  defaultHours,
  normalizeAnnouncementConfig,
  normalizeHoursConfig
} from "./lib/adminConfig";

describe("admin config helpers", () => {
  it("normalizes announcement config without treating markup as executable", () => {
    expect(
      normalizeAnnouncementConfig({
        active: true,
        text: " <img src=x onerror=alert(1)> ",
        type: "warning"
      })
    ).toEqual({
      active: true,
      text: "<img src=x onerror=alert(1)>",
      type: "warning"
    });
  });

  it("rejects unrecognized announcement types and overlong text", () => {
    expect(() => normalizeAnnouncementConfig({ active: true, text: "", type: "promo" })).toThrow(
      "announcement.type is not recognized"
    );
    expect(() => normalizeAnnouncementConfig({ active: true, text: "x".repeat(181), type: "info" })).toThrow(
      "announcement.text must be 180 characters or fewer"
    );
  });

  it("normalizes exact weekday hours", () => {
    expect(normalizeHoursConfig(defaultHours)).toEqual(defaultHours);
  });

  it("rejects missing, extra, or malformed hours", () => {
    const withoutMonday = { ...defaultHours };
    delete (withoutMonday as Partial<typeof defaultHours>).Monday;
    expect(() => normalizeHoursConfig(withoutMonday)).toThrow("hours.Monday is required");
    expect(() => normalizeHoursConfig({ ...defaultHours, Holiday: { open: "09:00", close: "12:00", closed: false } })).toThrow(
      "hours contains unknown day: Holiday"
    );
    expect(() =>
      normalizeHoursConfig({
        ...defaultHours,
        Friday: { open: "9:00", close: "18:00", closed: false }
      })
    ).toThrow("hours.Friday.open must be HH:mm");
  });

  it("keeps audit metadata compact and string-only", () => {
    expect(configAuditMetadata("hours", "front desk update")).toEqual({
      key: "hours",
      note: "front desk update"
    });
    expect(() => configAuditMetadata("announcement", "x".repeat(161))).toThrow("note must be 160 characters or fewer");
  });
});
