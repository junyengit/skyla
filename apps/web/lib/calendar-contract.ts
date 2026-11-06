import { addVisitDays, parseVisitDate } from "@skyla/payments";

export type CalendarRole = "admin" | "viewer";
export type CalendarConfirmationSource = "owner-confirmation" | "booking-record";
export type CalendarEvent = {
  eventRef: string;
  visitDate: string;
  status: "confirmed" | "cancelled";
  label: string;
  notes?: string;
  createdAt: number;
  cancelledAt?: number;
  cancelReason?: string;
  confirmationSource?: CalendarConfirmationSource;
  sourceRef?: string;
};
export type CalendarCreateRequest = {
  visitDate: string;
  label: string;
  notes?: string;
  confirmationSource?: CalendarConfirmationSource;
  sourceRef?: string;
  idempotencyKey: string;
};
export type CalendarCancelRequest = { eventRef: string; reason: string };
export type CalendarRange = { from: string; to: string };
export type CalendarRangeRequest = CalendarRange & { cursor?: string | null; endCursor?: string | null };
export type CalendarRangePage = {
  role: CalendarRole;
  range: CalendarRange;
  cutoff: number;
  events: CalendarEvent[];
  continueCursor: string | null;
  isDone: boolean;
  pageStatus: null | "SplitRecommended" | "SplitRequired";
  splitCursor: string | null;
  endCursor: string | null;
  segmentDone: boolean;
};
export type CalendarOperationLookup = { key: string } | { eventRef: string };
export type CalendarOperationResult = { role: CalendarRole; lookup: CalendarOperationLookup; event: CalendarEvent | null };
export type CalendarMutationIdentity =
  | { kind: "create"; request: CalendarCreateRequest }
  | { kind: "cancel"; request: CalendarCancelRequest };
export type CalendarMutationResult = { role: "admin"; event: CalendarEvent; reused: boolean };
export type CalendarAtomicRejection = {
  kind: "private_event_rejected";
  version: 1;
  operation: "create" | "cancel";
  lookup: CalendarOperationLookup;
  requestFingerprint: string;
  message: string;
};

/** Ephemeral request attestation only; never persist this plaintext fingerprint. */
export function calendarMutationFingerprint(identity: CalendarMutationIdentity) {
  if (identity.kind === "cancel") {
    const request = normalizeCalendarCancelRequest(identity.request);
    return `cancel-v1:${JSON.stringify([request.eventRef, request.reason])}`;
  }
  const request = normalizeCalendarCreateRequest(identity.request);
  return request.confirmationSource
    ? `v2:${JSON.stringify([request.visitDate, request.label, request.notes ?? null, request.confirmationSource, request.sourceRef])}`
    : `v1:${JSON.stringify([request.visitDate, request.label, request.notes ?? null])}`;
}

/** Routes call this only for actual ConvexError.data, not arbitrary exceptions. */
export function parseCalendarAtomicRejection(value: unknown, expected: CalendarMutationIdentity): CalendarAtomicRejection {
  try {
    const input = object(value, "atomic rejection");
    fields(input, ["kind", "version", "operation", "lookup", "requestFingerprint", "message"], "atomic rejection");
    if (Object.keys(input).length !== 6 || input.kind !== "private_event_rejected" || input.version !== 1 || input.operation !== expected.kind) invalidResponse();
    const lookup = normalizeCalendarOperationLookup(input.lookup);
    const expectedLookup: CalendarOperationLookup = expected.kind === "create"
      ? { key: normalizeCalendarCreateRequest(expected.request).idempotencyKey }
      : { eventRef: normalizeCalendarCancelRequest(expected.request).eventRef };
    const rawLookup = object(input.lookup, "lookup");
    if (Object.keys(rawLookup).length !== 1 ||
        ("key" in expectedLookup ? !("key" in lookup) || lookup.key !== expectedLookup.key || rawLookup.key !== lookup.key
          : !("eventRef" in lookup) || lookup.eventRef !== expectedLookup.eventRef || rawLookup.eventRef !== lookup.eventRef)) invalidResponse();
    if (typeof input.requestFingerprint !== "string" || input.requestFingerprint.length > 8192 ||
        input.requestFingerprint !== calendarMutationFingerprint(expected)) invalidResponse();
    const message = text(input.message, "message", 500);
    if (input.message !== message) invalidResponse();
    return { kind: "private_event_rejected", version: 1, operation: expected.kind, lookup, requestFingerprint: input.requestFingerprint, message };
  } catch { return invalidResponse(); }
}

/** This proves only this request was rejected; a previous unknown stays unknown. */
export function parseCalendarMutationRejection(value: unknown, expected: CalendarMutationIdentity): CalendarAtomicRejection {
  try {
    const input = object(value, "rejection response");
    fields(input, ["error", "code", "rejection"], "rejection response");
    if (Object.keys(input).length !== 3 || input.code !== "calendar_mutation_rejected") invalidResponse();
    const rejection = parseCalendarAtomicRejection(input.rejection, expected);
    if (input.error !== rejection.message) invalidResponse();
    return rejection;
  } catch { return invalidResponse(); }
}

export class CalendarRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarRequestError";
  }
}
/** A reply whose operation or completeness cannot be trusted. Keep recovery. */
export class CalendarResponseError extends Error {
  constructor() {
    super("Calendar response could not be verified");
    this.name = "CalendarResponseError";
  }
}
function invalidResponse(): never { throw new CalendarResponseError(); }
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CalendarRequestError(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function fields(input: Record<string, unknown>, allowed: readonly string[], label: string) {
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new CalendarRequestError(`${label} must contain only supported fields`);
}
function text(value: unknown, label: string, max: number) {
  if (typeof value !== "string" || !value.trim()) throw new CalendarRequestError(`${label} is required`);
  const normalized = value.trim();
  if (normalized.length > max) throw new CalendarRequestError(`${label} must be ${max} characters or fewer`);
  return normalized;
}
function optionalText(value: unknown, label: string, max: number) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new CalendarRequestError(`${label} must be a string`);
  return value.trim() ? text(value, label, max) : undefined;
}
export function calendarDate(value: unknown, label = "visitDate") {
  const date = parseVisitDate(value);
  if (!date) throw new CalendarRequestError(`${label} must be a real YYYY-MM-DD date`);
  return date;
}
export function calendarKey(value: unknown) {
  const key = text(value, "idempotencyKey", 96);
  if (!/^[A-Za-z0-9:_-]{12,96}$/.test(key)) throw new CalendarRequestError("idempotencyKey must be 12-96 URL-safe characters");
  return key;
}
export function calendarEventRef(value: unknown) {
  const ref = text(value, "eventRef", 40);
  if (!/^PEV\d{8}-[A-Z0-9]{6}$/.test(ref) || !parseVisitDate(`${ref.slice(3, 7)}-${ref.slice(7, 9)}-${ref.slice(9, 11)}`)) {
    throw new CalendarRequestError("eventRef must be a private event reference");
  }
  return ref;
}
export function normalizeCalendarRange(value: CalendarRange): CalendarRange {
  const from = calendarDate(value.from, "from");
  const to = calendarDate(value.to, "to");
  if (to < from) throw new CalendarRequestError("to must be on or after from");
  if (to > addVisitDays(from, 365)) throw new CalendarRequestError("range must contain at most 366 dates");
  return { from, to };
}
export function calendarCursor(value: unknown, label = "cursor"): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !value || value.length > 8192 || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new CalendarRequestError(`${label} must be a bounded opaque cursor`);
  }
  return value;
}

/** Syntax only: the backend checks existing keys before new-date/source rules. */
export function normalizeCalendarCreateRequest(value: unknown): CalendarCreateRequest {
  const input = object(value, "private event request");
  fields(input, ["visitDate", "label", "notes", "confirmationSource", "sourceRef", "idempotencyKey"], "private event request");
  const notes = optionalText(input.notes, "notes", 500);
  const sourceRef = optionalText(input.sourceRef, "sourceRef", 200);
  const source = input.confirmationSource;
  if (source !== undefined && source !== "owner-confirmation" && source !== "booking-record") {
    throw new CalendarRequestError("confirmationSource must be owner-confirmation or booking-record");
  }
  if ((source === undefined) !== (sourceRef === undefined)) throw new CalendarRequestError("confirmationSource and sourceRef must be supplied together");
  return {
    visitDate: calendarDate(input.visitDate), label: text(input.label, "label", 120),
    ...(notes ? { notes } : {}), ...(source ? { confirmationSource: source, sourceRef } : {}),
    idempotencyKey: calendarKey(input.idempotencyKey)
  };
}
export function normalizeCalendarCancelRequest(value: unknown): CalendarCancelRequest {
  const input = object(value, "private event cancellation");
  fields(input, ["eventRef", "reason"], "private event cancellation");
  return { eventRef: calendarEventRef(input.eventRef), reason: text(input.reason, "reason", 300) };
}

export function parseCalendarRole(value: unknown): CalendarRole {
  if (value !== "admin" && value !== "viewer") invalidResponse();
  return value;
}
function timestamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalidResponse();
  return value;
}
export function parseCalendarEvent(value: unknown): CalendarEvent {
  try {
    const input = object(value, "event");
    fields(input, ["eventRef", "visitDate", "status", "label", "notes", "createdAt", "cancelledAt", "cancelReason", "confirmationSource", "sourceRef"], "event");
    const eventRef = calendarEventRef(input.eventRef);
    const visitDate = calendarDate(input.visitDate);
    if (input.eventRef !== eventRef || input.visitDate !== visitDate || eventRef.slice(3, 11) !== visitDate.replaceAll("-", "") ||
        (input.status !== "confirmed" && input.status !== "cancelled")) invalidResponse();
    const label = text(input.label, "label", 120);
    const notes = optionalText(input.notes, "notes", 500);
    const sourceRef = optionalText(input.sourceRef, "sourceRef", 200);
    if (input.label !== label || (input.notes !== undefined && input.notes !== notes) ||
        (input.sourceRef !== undefined && input.sourceRef !== sourceRef)) invalidResponse();
    const source = input.confirmationSource;
    if (source !== undefined && source !== "owner-confirmation" && source !== "booking-record") invalidResponse();
    if ((source === undefined) !== (sourceRef === undefined)) invalidResponse();
    const createdAt = timestamp(input.createdAt);
    let cancellation: { cancelledAt: number; cancelReason: string } | undefined;
    if (input.status === "cancelled") {
      const cancelledAt = timestamp(input.cancelledAt);
      const cancelReason = text(input.cancelReason, "cancelReason", 300);
      if (cancelledAt < createdAt || input.cancelReason !== cancelReason) invalidResponse();
      cancellation = { cancelledAt, cancelReason };
    } else if (input.cancelledAt !== undefined || input.cancelReason !== undefined) invalidResponse();
    return { eventRef, visitDate, status: input.status, label, ...(notes ? { notes } : {}),
      createdAt, ...cancellation, ...(source ? { confirmationSource: source, sourceRef } : {}) };
  } catch { return invalidResponse(); }
}

export function calendarEventMatchesCreate(event: CalendarEvent, request: CalendarCreateRequest) {
  return event.visitDate === request.visitDate && event.label === request.label &&
    event.notes === request.notes && event.confirmationSource === request.confirmationSource && event.sourceRef === request.sourceRef;
}
export function parseCalendarMutationResult(value: unknown, expected: CalendarMutationIdentity): CalendarMutationResult {
  try {
    const input = object(value, "mutation response");
    fields(input, ["role", "event", "reused"], "mutation response");
    if (parseCalendarRole(input.role) !== "admin" || typeof input.reused !== "boolean") invalidResponse();
    const event = parseCalendarEvent(input.event);
    if (expected.kind === "create") {
      if (!calendarEventMatchesCreate(event, expected.request) ||
          (!input.reused && (event.status !== "confirmed" || !event.confirmationSource || !event.sourceRef))) invalidResponse();
    } else if (event.eventRef !== expected.request.eventRef || event.status !== "cancelled" ||
        (!input.reused && event.cancelReason !== expected.request.reason)) invalidResponse();
    return { role: "admin", event, reused: input.reused };
  } catch { return invalidResponse(); }
}

export function normalizeCalendarOperationLookup(value: unknown): CalendarOperationLookup {
  const input = object(value, "operation lookup");
  fields(input, ["key", "eventRef"], "operation lookup");
  if ((input.key === undefined) === (input.eventRef === undefined)) throw new CalendarRequestError("operation lookup must contain exactly one key or eventRef");
  return input.key !== undefined ? { key: calendarKey(input.key) } : { eventRef: calendarEventRef(input.eventRef) };
}
export function parseCalendarOperationResult(value: unknown, expected: CalendarOperationLookup): CalendarOperationResult {
  try {
    const input = object(value, "operation response");
    fields(input, ["role", "lookup", "event"], "operation response");
    const role = parseCalendarRole(input.role);
    const lookup = normalizeCalendarOperationLookup(input.lookup);
    const rawLookup = object(input.lookup, "lookup");
    if ("key" in lookup ? rawLookup.key !== lookup.key : rawLookup.eventRef !== lookup.eventRef) invalidResponse();
    const identity = normalizeCalendarOperationLookup(expected);
    if (("key" in identity && (!("key" in lookup) || lookup.key !== identity.key)) ||
        ("eventRef" in identity && (!("eventRef" in lookup) || lookup.eventRef !== identity.eventRef))) invalidResponse();
    const event = input.event === null ? null : parseCalendarEvent(input.event);
    if (event && "eventRef" in identity && event.eventRef !== identity.eventRef) invalidResponse();
    return { role, lookup, event };
  } catch { return invalidResponse(); }
}

/** Splits are incomplete; discard their events and reread both bounded halves. */
export function parseCalendarRangePage(value: unknown, expected: CalendarRangeRequest & { cutoff?: number }): CalendarRangePage {
  try {
    const input = object(value, "range response");
    fields(input, ["role", "range", "cutoff", "events", "continueCursor", "isDone", "pageStatus", "splitCursor", "endCursor", "segmentDone"], "range response");
    const rawRange = object(input.range, "range");
    fields(rawRange, ["from", "to"], "range");
    const range = normalizeCalendarRange({ from: rawRange.from as string, to: rawRange.to as string });
    const requested = normalizeCalendarRange(expected);
    const cutoff = timestamp(input.cutoff);
    if (rawRange.from !== range.from || rawRange.to !== range.to || range.from !== requested.from || range.to !== requested.to ||
        (expected.cutoff !== undefined && cutoff !== expected.cutoff)) invalidResponse();
    if (input.continueCursor === undefined || input.splitCursor === undefined || input.endCursor === undefined ||
        typeof input.isDone !== "boolean" || typeof input.segmentDone !== "boolean" ||
        ![null, "SplitRecommended", "SplitRequired"].includes(input.pageStatus as string | null)) invalidResponse();
    const continueCursor = calendarCursor(input.continueCursor);
    const splitCursor = calendarCursor(input.splitCursor, "splitCursor");
    const endCursor = calendarCursor(input.endCursor, "endCursor");
    const start = calendarCursor(expected.cursor);
    if (endCursor !== calendarCursor(expected.endCursor, "endCursor")) invalidResponse();
    if (input.pageStatus !== null) {
      if (!continueCursor || !splitCursor || continueCursor === splitCursor || splitCursor === start ||
          continueCursor === start || input.isDone || input.segmentDone) invalidResponse();
    } else {
      if (splitCursor !== null || (endCursor !== null && input.isDone) ||
          (endCursor === null && input.isDone !== input.segmentDone) ||
          (input.segmentDone ? continueCursor !== null : continueCursor === null || continueCursor === start)) invalidResponse();
    }
    if (!Array.isArray(input.events) || input.events.length > 100) invalidResponse();
    const events = input.events.map(parseCalendarEvent);
    const refs = new Set<string>();
    for (const [index, event] of events.entries()) {
      if (event.visitDate < range.from || event.visitDate > range.to || event.createdAt > cutoff || refs.has(event.eventRef) ||
          (index > 0 && events[index - 1]!.visitDate > event.visitDate)) invalidResponse();
      refs.add(event.eventRef);
    }
    return { role: parseCalendarRole(input.role), range, cutoff, events, continueCursor,
      isDone: input.isDone, pageStatus: input.pageStatus as CalendarRangePage["pageStatus"], splitCursor, endCursor,
      segmentDone: input.segmentDone };
  } catch { return invalidResponse(); }
}

/** Compatibility only. This limited read makes no exhausted-range claim. */
export function parseCalendarLegacyList(value: unknown, expected: { from?: string; limit?: number } = {}) {
  try {
    const input = object(value, "legacy response");
    fields(input, ["fromDate", "events", "role"], "legacy response");
    const fromDate = calendarDate(input.fromDate, "fromDate");
    if ((expected.from !== undefined && fromDate !== expected.from) || !Array.isArray(input.events) ||
        input.events.length > (expected.limit ?? 50)) invalidResponse();
    const events = input.events.map(parseCalendarEvent);
    if (events.some(event => event.visitDate < fromDate) || new Set(events.map(event => event.eventRef)).size !== events.length) invalidResponse();
    return { fromDate, events, ...(input.role === undefined ? {} : { role: parseCalendarRole(input.role) }) };
  } catch { return invalidResponse(); }
}

export function calendarQueryParameters(params: URLSearchParams, allowed: readonly string[]) {
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) throw new CalendarRequestError("query must contain only supported, unique parameters");
  }
}
