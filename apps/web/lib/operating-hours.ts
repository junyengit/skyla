import {
  isEntryWithinHours,
  visitTimeMinutes,
  visitWeekdayForDate,
  visitWeekdays,
  type VisitHours,
  type VisitHoursDay,
  type VisitWeekday
} from "@skyla/payments";

export const operatingWeekdays = visitWeekdays;

export type OperatingWeekday = VisitWeekday;
export type OperatingDay = VisitHoursDay;
export type OperatingHours = VisitHours;
export type PublicOperatingConfig = {
  announcement: {
    text: string;
    type: "info" | "warning" | "success";
  } | null;
  operatingHours: OperatingHours;
  timeZone: "America/Los_Angeles";
};

const announcementTypes = new Set(["info", "warning", "success"]);
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseAnnouncement(value: unknown): PublicOperatingConfig["announcement"] | undefined {
  if (value === null) return null;
  const record = objectRecord(value);
  if (
    !record ||
    typeof record.text !== "string" ||
    !record.text.trim() ||
    record.text.length > 180 ||
    !announcementTypes.has(String(record.type))
  ) {
    return undefined;
  }
  return {
    text: record.text,
    type: record.type as "info" | "warning" | "success"
  };
}

function parseOperatingHours(value: unknown): OperatingHours | null {
  const record = objectRecord(value);
  if (!record || Object.keys(record).some((key) => !operatingWeekdays.includes(key as OperatingWeekday))) {
    return null;
  }

  const entries = operatingWeekdays.map((day) => {
    const dayRecord = objectRecord(record[day]);
    if (
      !dayRecord ||
      typeof dayRecord.open !== "string" ||
      typeof dayRecord.close !== "string" ||
      typeof dayRecord.closed !== "boolean" ||
      !timePattern.test(dayRecord.open) ||
      !timePattern.test(dayRecord.close)
    ) {
      return null;
    }
    return [
      day,
      {
        open: dayRecord.open,
        close: dayRecord.close,
        closed: dayRecord.closed
      }
    ] as const;
  });

  if (entries.some((entry) => entry === null)) return null;
  return Object.fromEntries(entries as Array<readonly [OperatingWeekday, OperatingDay]>) as OperatingHours;
}

export function parsePublicOperatingConfig(value: unknown): PublicOperatingConfig | null {
  const record = objectRecord(value);
  if (!record || record.timeZone !== "America/Los_Angeles") return null;

  const announcement = parseAnnouncement(record.announcement);
  const operatingHours = parseOperatingHours(record.operatingHours);
  if (announcement === undefined || !operatingHours) return null;

  return {
    announcement,
    operatingHours,
    timeZone: "America/Los_Angeles"
  };
}

export function operatingWeekdayForDate(visitDate: string): OperatingWeekday | null {
  return visitWeekdayForDate(visitDate);
}

export function isCheckoutEntryTimeAvailable(
  operatingHours: OperatingHours,
  visitDate: string,
  entryTime: string
) {
  return isEntryWithinHours(operatingHours, visitDate, entryTime);
}

function formatTime(value: string) {
  const minutes = visitTimeMinutes(value);
  if (minutes === null) return value;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  if (hour === 0 && minute === 0) return "midnight";
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function formatOperatingDay(day: OperatingDay) {
  return day.closed ? "Closed" : `${formatTime(day.open)} - ${formatTime(day.close)}`;
}
