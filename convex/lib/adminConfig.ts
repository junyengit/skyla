export const siteConfigKeys = ["announcement", "hours"] as const;
export const announcementTypes = ["info", "warning", "success"] as const;
export const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export type SiteConfigKey = (typeof siteConfigKeys)[number];
export type AnnouncementType = (typeof announcementTypes)[number];
export type Weekday = (typeof weekdays)[number];

export type SiteAnnouncementConfig = {
  active: boolean;
  text: string;
  type: AnnouncementType;
};

export type SiteHoursDayConfig = {
  open: string;
  close: string;
  closed: boolean;
};

export type SiteHoursConfig = Record<Weekday, SiteHoursDayConfig>;

export const defaultAnnouncement: SiteAnnouncementConfig = {
  active: false,
  text: "",
  type: "info"
};

export const defaultHours: SiteHoursConfig = {
  Monday: { open: "09:00", close: "00:00", closed: false },
  Tuesday: { open: "09:00", close: "00:00", closed: false },
  Wednesday: { open: "09:00", close: "00:00", closed: false },
  Thursday: { open: "09:00", close: "00:00", closed: false },
  Friday: { open: "09:00", close: "00:00", closed: false },
  Saturday: { open: "09:00", close: "00:00", closed: false },
  Sunday: { open: "09:00", close: "00:00", closed: false }
};

const maxAnnouncementLength = 180;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isSiteConfigKey(value: unknown): value is SiteConfigKey {
  return typeof value === "string" && siteConfigKeys.includes(value as SiteConfigKey);
}

export function normalizeAnnouncementConfig(value: unknown): SiteAnnouncementConfig {
  const record = objectRecord(value, "announcement");
  const text = stringValue(record.text, "announcement.text").trim();
  if (text.length > maxAnnouncementLength) {
    throw new Error(`announcement.text must be ${maxAnnouncementLength} characters or fewer`);
  }

  return {
    active: booleanValue(record.active, "announcement.active"),
    text,
    type: announcementType(record.type)
  };
}

export function normalizeHoursConfig(value: unknown): SiteHoursConfig {
  const record = objectRecord(value, "hours");
  const keys = Object.keys(record);
  const extraKeys = keys.filter((key) => !weekdays.includes(key as Weekday));
  if (extraKeys.length) {
    throw new Error(`hours contains unknown day: ${extraKeys[0]}`);
  }

  return Object.fromEntries(
    weekdays.map((day) => {
      if (!(day in record)) {
        throw new Error(`hours.${day} is required`);
      }
      const dayRecord = objectRecord(record[day], `hours.${day}`);
      const open = timeValue(dayRecord.open, `hours.${day}.open`);
      const close = timeValue(dayRecord.close, `hours.${day}.close`);
      const closed = booleanValue(dayRecord.closed, `hours.${day}.closed`);
      return [day, { open, close, closed }];
    })
  ) as SiteHoursConfig;
}

export function normalizeSiteConfig(key: SiteConfigKey, data: unknown) {
  return key === "announcement" ? normalizeAnnouncementConfig(data) : normalizeHoursConfig(data);
}

export function defaultSiteConfig(key: SiteConfigKey) {
  return key === "announcement" ? defaultAnnouncement : defaultHours;
}

export function configAuditMetadata(key: SiteConfigKey, note?: string) {
  const metadata: Record<string, string> = { key };
  const trimmedNote = note?.trim();
  if (trimmedNote) {
    if (trimmedNote.length > 160) {
      throw new Error("note must be 160 characters or fewer");
    }
    metadata.note = trimmedNote;
  }
  return metadata;
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

function booleanValue(value: unknown, label: string) {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function announcementType(value: unknown) {
  if (!announcementTypes.includes(value as AnnouncementType)) {
    throw new Error("announcement.type is not recognized");
  }
  return value as AnnouncementType;
}

function timeValue(value: unknown, label: string) {
  const time = stringValue(value, label).trim();
  if (!timePattern.test(time)) {
    throw new Error(`${label} must be HH:mm`);
  }
  return time;
}
