import { addVisitDays, parseVisitDate, venueToday } from "@skyla/payments";

import { normalizeIdempotencyKey } from "./orderDraftPersistence";

// Confirmed private events block their whole America/Los_Angeles date. An
// inquiry is only a lead and never blocks by itself.
export const privateEventHorizonDays = 3 * 365;
export const privateEventListLimit = 100;

export type PrivateEventInput = {
  visitDate: string;
  label: string;
  notes?: string;
  idempotencyKey: string;
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

export function normalizePrivateEventInput(input: PrivateEventInput, now: number): PrivateEventInput {
  const visitDate = parseVisitDate(input.visitDate);
  if (!visitDate) {
    throw new Error("visitDate must be a real YYYY-MM-DD date");
  }
  const today = venueToday(now);
  if (visitDate < today) {
    throw new Error("visitDate must be today or later in Los Angeles");
  }
  if (visitDate > addVisitDays(today, privateEventHorizonDays)) {
    throw new Error(`visitDate must be within ${privateEventHorizonDays} days`);
  }
  const notes = optionalText(input.notes, "notes", 500);
  return {
    visitDate,
    label: requiredText(input.label, "label", 120),
    ...(notes ? { notes } : {}),
    idempotencyKey: normalizeIdempotencyKey(input.idempotencyKey)
  };
}

export function privateEventFingerprint(input: PrivateEventInput) {
  return `v1:${JSON.stringify([input.visitDate, input.label, input.notes ?? null])}`;
}

export function privateEventRefFromId(id: string, visitDate: string) {
  const suffix = id.replace(/[^A-Za-z0-9]/g, "").slice(-6).toUpperCase().padStart(6, "0");
  return `PEV${visitDate.replaceAll("-", "")}-${suffix}`;
}

export function normalizeCancelReason(value: unknown) {
  return requiredText(value, "reason", 300);
}
