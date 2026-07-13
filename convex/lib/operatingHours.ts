import {
  defaultHours,
  normalizeHoursConfig,
  type SiteHoursConfig,
  type Weekday
} from "./adminConfig";

const weekdays: Weekday[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export function safeOperatingHours(value: unknown): SiteHoursConfig {
  try {
    return normalizeHoursConfig(value ?? defaultHours);
  } catch {
    return normalizeHoursConfig(defaultHours);
  }
}

export function operatingWeekdayForDate(visitDate: string): Weekday | null {
  if (!datePattern.test(visitDate)) return null;
  const date = new Date(`${visitDate}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== visitDate) return null;
  return weekdays[(date.getUTCDay() + 6) % 7];
}

export function isCheckoutTimeAvailable(hours: SiteHoursConfig, visitDate: string, entryTime: string) {
  const weekday = operatingWeekdayForDate(visitDate);
  const entryMinutes = timeMinutes(entryTime);
  if (!weekday || entryMinutes === null) return false;

  const day = hours[weekday];
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

export function assertCheckoutTimeAvailable(
  hours: SiteHoursConfig,
  visitDate: string | undefined,
  entryTime: string | undefined
) {
  if (visitDate && entryTime && !isCheckoutTimeAvailable(hours, visitDate, entryTime)) {
    throw new Error("entryTime is outside the configured operating hours for visitDate");
  }
}

function timeMinutes(value: string) {
  if (!timePattern.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}
