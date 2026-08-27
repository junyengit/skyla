export const operatingWeekdays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday"
] as const;

export type OperatingWeekday = (typeof operatingWeekdays)[number];
export type OperatingDay = {
  open: string;
  close: string;
  closed: boolean;
};
export type OperatingHours = Record<OperatingWeekday, OperatingDay>;
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
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

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
  const match = datePattern.exec(visitDate);
  if (!match) return null;
  const date = new Date(`${visitDate}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== visitDate) return null;
  const mondayBasedDay = (date.getUTCDay() + 6) % 7;
  return operatingWeekdays[mondayBasedDay];
}

export function operatingWeekdayForInstant(
  instant: Date,
  timeZone: PublicOperatingConfig["timeZone"]
): OperatingWeekday | null {
  if (!Number.isFinite(instant.getTime())) return null;
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone
  }).format(instant);
  return operatingWeekdays.find((day) => day === weekday) ?? null;
}

function timeMinutes(value: string) {
  if (!timePattern.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function isCheckoutEntryTimeAvailable(
  operatingHours: OperatingHours,
  visitDate: string,
  entryTime: string
) {
  const weekday = operatingWeekdayForDate(visitDate);
  const entryMinutes = timeMinutes(entryTime);
  if (!weekday || entryMinutes === null) return false;

  const day = operatingHours[weekday];
  if (day.closed) return false;
  const openMinutes = timeMinutes(day.open);
  const closeMinutes = timeMinutes(day.close);
  if (openMinutes === null || closeMinutes === null) return false;
  if (openMinutes === closeMinutes) return true;
  if (openMinutes < closeMinutes) {
    return entryMinutes >= openMinutes && entryMinutes < closeMinutes;
  }
  return entryMinutes >= openMinutes || entryMinutes < closeMinutes;
}

function formatTime(value: string) {
  const minutes = timeMinutes(value);
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
