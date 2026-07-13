import { describe, expect, it } from "vitest";

import { defaultHours } from "./lib/adminConfig";
import { projectPublicOperatingConfig } from "./publicConfig";

describe("public operating config", () => {
  it("projects only active public announcement fields and normalized hours", () => {
    const projected = projectPublicOperatingConfig({
      announcement: {
        active: true,
        text: " <img src=x onerror=alert(1)> ",
        type: "warning",
        internalNote: "do not expose"
      },
      hours: {
        ...defaultHours,
        Monday: { open: "11:00", close: "19:00", closed: false }
      }
    });

    expect(projected).toEqual({
      announcement: {
        text: "<img src=x onerror=alert(1)>",
        type: "warning"
      },
      operatingHours: {
        ...defaultHours,
        Monday: { open: "11:00", close: "19:00", closed: false }
      },
      timeZone: "America/Los_Angeles"
    });
    expect(JSON.stringify(projected)).not.toContain("internalNote");
    expect(JSON.stringify(projected)).not.toContain("active");
  });

  it("does not expose inactive or malformed announcements", () => {
    expect(
      projectPublicOperatingConfig({
        announcement: { active: false, text: "Staff-only draft", type: "info" },
        hours: defaultHours
      }).announcement
    ).toBeNull();
    expect(
      projectPublicOperatingConfig({
        announcement: { active: true, text: "Invalid type", type: "promo" },
        hours: defaultHours
      }).announcement
    ).toBeNull();
  });

  it("uses established operating defaults for missing or malformed hours", () => {
    expect(projectPublicOperatingConfig({}).operatingHours).toEqual(defaultHours);
    expect(
      projectPublicOperatingConfig({
        hours: {
          ...defaultHours,
          Friday: { open: "9:00", close: "18:00", closed: false }
        }
      }).operatingHours
    ).toEqual(defaultHours);
  });
});
