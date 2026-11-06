import { addVisitDays, parseVisitDate, venueToday } from "@skyla/payments";

import { normalizeIdempotencyKey } from "./orderDraftPersistence";

// Confirmed private events block their whole America/Los_Angeles date. An
// inquiry is only a lead and never blocks by itself.
export const privateEventHorizonDays = 3 * 365;
export const privateEventListLimit = 100;
export const privateEventPageSize = 25;
export const privateEventRowsRead = 100;
export const privateEventBytesRead = 256 * 1024;
export type PrivateEventConfirmationSource = "owner-confirmation" | "booking-record";

export type PrivateEventInput = {
  visitDate: string;
  label: string;
  notes?: string;
  confirmationSource?: string;
  sourceRef?: string;
  idempotencyKey: string;
};
export type NormalizedPrivateEventInput = Omit<PrivateEventInput, "confirmationSource"> & {
  confirmationSource?: PrivateEventConfirmationSource;
};

function requiredText(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer`);
  }
  return trimmed;
}

function optionalText(value: unknown, label: string, maxLength: number) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer`);
  return trimmed;
}

/** Syntax is separate from today's rules so unchanged successful requests can recover after midnight. */
export function normalizePrivateEventRequest(input: PrivateEventInput): NormalizedPrivateEventInput {
  const visitDate = parseVisitDate(input.visitDate);
  if (!visitDate) {
    throw new Error("visitDate must be a real YYYY-MM-DD date");
  }
  const notes = optionalText(input.notes, "notes", 500);
  const source = input.confirmationSource;
  if (source !== undefined && source !== "owner-confirmation" && source !== "booking-record") {
    throw new Error("confirmationSource must be owner-confirmation or booking-record");
  }
  const sourceRef = optionalText(input.sourceRef, "sourceRef", 200);
  if ((source === undefined) !== (sourceRef === undefined)) {
    throw new Error("confirmationSource and sourceRef are required together");
  }
  return {
    visitDate,
    label: requiredText(input.label, "label", 120),
    ...(notes ? { notes } : {}),
    ...(source ? { confirmationSource: source, sourceRef } : {}),
    idempotencyKey: normalizeIdempotencyKey(input.idempotencyKey)
  };
}

export function assertNewPrivateEventDate(visitDate: string, now: number) {
  const today = venueToday(now);
  if (visitDate < today) throw new Error("visitDate must be today or later in Los Angeles");
  if (visitDate > addVisitDays(today, privateEventHorizonDays)) {
    throw new Error(`visitDate must be within ${privateEventHorizonDays} days`);
  }
}

export function normalizePrivateEventInput(input: PrivateEventInput, now: number) {
  const normalized = normalizePrivateEventRequest(input);
  assertNewPrivateEventDate(normalized.visitDate, now);
  return normalized;
}

export function privateEventFingerprint(input: PrivateEventInput) {
  const legacy = [input.visitDate, input.label, input.notes ?? null];
  return input.confirmationSource === undefined
    ? `v1:${JSON.stringify(legacy)}`
    : `v2:${JSON.stringify([...legacy, input.confirmationSource, input.sourceRef])}`;
}

export function privateEventCancelFingerprint(input: { eventRef: string; reason: string }) {
  return `cancel-v1:${JSON.stringify([input.eventRef, input.reason])}`;
}

export function privateEventRefFromId(id: string, visitDate: string) {
  const suffix = id.replace(/[^A-Za-z0-9]/g, "").slice(-6).toUpperCase().padStart(6, "0");
  return `PEV${visitDate.replaceAll("-", "")}-${suffix}`;
}

export function normalizeCancelReason(value: unknown) {
  return requiredText(value, "reason", 300);
}

export function normalizePrivateEventRef(value: string) {
  const ref = requiredText(value, "eventRef", 80);
  if (!/^PEV\d{8}-[A-Z0-9]{6}$/.test(ref)) throw new Error("eventRef is invalid");
  if (!parseVisitDate(`${ref.slice(3, 7)}-${ref.slice(7, 9)}-${ref.slice(9, 11)}`)) throw new Error("eventRef date is invalid");
  return ref;
}

export function normalizePrivateEventRange(from: string, to: string) {
  const normalizedFrom = parseVisitDate(from);
  const normalizedTo = parseVisitDate(to);
  if (!normalizedFrom || !normalizedTo) throw new Error("from and to must be real YYYY-MM-DD dates");
  if (normalizedFrom > normalizedTo || normalizedTo > addVisitDays(normalizedFrom, 365)) {
    throw new Error("Calendar range must be ordered and cover at most 366 inclusive days");
  }
  return { from: normalizedFrom, to: normalizedTo };
}

type CalendarCursor = { v: 1; from: string; to: string; cutoff: number; native: string };
const calendarCursorLimit = 8_192;
export function encodePrivateEventCursor(range: { from: string; to: string }, cutoff: number, native: string) {
  const encoded = `pev1.${encodeURIComponent(JSON.stringify({ v: 1, ...range, cutoff, native }))}`;
  if (encoded.length > calendarCursorLimit) throw new Error("Calendar cursor exceeds supported bounds");
  return encoded;
}
export function decodePrivateEventCursor(value: string, range: { from: string; to: string }, now: number): CalendarCursor {
  try {
    if (!value.startsWith("pev1.") || value.length > calendarCursorLimit) throw new Error();
    const data = JSON.parse(decodeURIComponent(value.slice(5))) as CalendarCursor;
    if (data.v !== 1 || data.from !== range.from || data.to !== range.to ||
        !Number.isSafeInteger(data.cutoff) || data.cutoff < 0 || data.cutoff > now ||
        typeof data.native !== "string" || !data.native) throw new Error();
    return data;
  } catch {
    throw new Error("Calendar cursor is invalid for this range or cutoff");
  }
}
