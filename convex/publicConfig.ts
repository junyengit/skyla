import { query } from "./_generated/server";
import {
  defaultAnnouncement,
  defaultHours,
  normalizeAnnouncementConfig,
  normalizeHoursConfig,
  type SiteHoursConfig
} from "./lib/adminConfig";

export type PublicOperatingConfig = {
  announcement: {
    text: string;
    type: "info" | "warning" | "success";
  } | null;
  operatingHours: SiteHoursConfig;
  timeZone: "America/Los_Angeles";
};

function publicAnnouncement(data: unknown): PublicOperatingConfig["announcement"] {
  try {
    const announcement = normalizeAnnouncementConfig(data ?? defaultAnnouncement);
    if (!announcement.active || !announcement.text) {
      return null;
    }
    return {
      text: announcement.text,
      type: announcement.type
    };
  } catch {
    return null;
  }
}

function publicOperatingHours(data: unknown) {
  try {
    return normalizeHoursConfig(data ?? defaultHours);
  } catch {
    return normalizeHoursConfig(defaultHours);
  }
}

export function projectPublicOperatingConfig(input: {
  announcement?: unknown;
  hours?: unknown;
}): PublicOperatingConfig {
  return {
    announcement: publicAnnouncement(input.announcement),
    operatingHours: publicOperatingHours(input.hours),
    timeZone: "America/Los_Angeles"
  };
}

export const getPublicOperatingConfig = query({
  args: {},
  handler: async (ctx) => {
    const [announcementRow, hoursRow] = await Promise.all([
      ctx.db
        .query("config")
        .withIndex("by_key", (q) => q.eq("key", "announcement"))
        .unique(),
      ctx.db
        .query("config")
        .withIndex("by_key", (q) => q.eq("key", "hours"))
        .unique()
    ]);

    return projectPublicOperatingConfig({
      announcement: announcementRow?.data,
      hours: hoursRow?.data
    });
  }
});
