import { isEntryWithinHours, visitWeekdayForDate } from "@skyla/payments";

import {
  defaultHours,
  normalizeHoursConfig,
  type SiteHoursConfig,
  type Weekday
} from "./adminConfig";

// A missing hours row uses the documented owner-confirmed defaultHours; an
// invalid row also falls back to them rather than to all-day booking.
export function safeOperatingHours(value: unknown): SiteHoursConfig {
  try {
    return normalizeHoursConfig(value ?? defaultHours);
  } catch {
    return normalizeHoursConfig(defaultHours);
  }
}

export function operatingWeekdayForDate(visitDate: string): Weekday | null {
  return visitWeekdayForDate(visitDate);
}

export function isCheckoutTimeAvailable(hours: SiteHoursConfig, visitDate: string, entryTime: string) {
  return isEntryWithinHours(hours, visitDate, entryTime);
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
