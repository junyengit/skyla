import {
  calendarEventRef, calendarKey, normalizeCalendarCancelRequest, normalizeCalendarCreateRequest,
  type CalendarEvent, type CalendarMutationIdentity, type CalendarRange, type CalendarRangePage, type CalendarRole
} from "@/lib/calendar-contract";

/** Only operation identity is durable. No source text, notes, contact or credential. */
export type CalendarOperation =
  | { version: 1; kind: "create"; key: string; digest: string }
  | { version: 1; kind: "cancel"; eventRef: string; digest: string };
export type CalendarOperationSlot =
  | { kind: "empty" } | { kind: "operation"; operation: CalendarOperation }
  | { kind: "unreadable" } | { kind: "corrupt" };
export const calendarOperationStorageKey = "skyla:calendar-operation";
export const calendarOperationChangeEvent = "skyla:calendar-operation-change";
export const calendarOperationLockName = "skyla:calendar-operation-lock";
const unreadable = "\u0000unreadable";

export function readCalendarOperationSnapshot(): string | null {
  try { return window.localStorage.getItem(calendarOperationStorageKey); } catch { return unreadable; }
}
export function parseCalendarOperationSnapshot(raw: string | null): CalendarOperationSlot {
  if (raw === null) return { kind: "empty" };
  if (raw === unreadable) return { kind: "unreadable" };
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1 ||
        typeof value.digest !== "string" || !/^[a-f0-9]{64}$/.test(value.digest)) return { kind: "corrupt" };
    const fields = value.kind === "create" ? ["version", "kind", "key", "digest"] : ["version", "kind", "eventRef", "digest"];
    if (Object.keys(value).some(key => !fields.includes(key)) || Object.keys(value).length !== 4) return { kind: "corrupt" };
    if (value.kind === "create" && calendarKey(value.key) === value.key) return { kind: "operation", operation: value };
    if (value.kind === "cancel" && calendarEventRef(value.eventRef) === value.eventRef) return { kind: "operation", operation: value };
  } catch { /* Preserve an unreadable operation instead of treating it as empty. */ }
  return { kind: "corrupt" };
}
export function readCalendarOperationSlot() { return parseCalendarOperationSnapshot(readCalendarOperationSnapshot()); }
export function subscribeCalendarOperation(change: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === calendarOperationStorageKey || event.key === null) change(); };
  window.addEventListener("storage", storage);
  window.addEventListener(calendarOperationChangeEvent, change);
  return () => { window.removeEventListener("storage", storage); window.removeEventListener(calendarOperationChangeEvent, change); };
}
export function sameCalendarOperation(a: CalendarOperation, b: CalendarOperation) {
  return a.kind === b.kind && a.digest === b.digest &&
    (a.kind === "create" && b.kind === "create" ? a.key === b.key : a.kind === "cancel" && b.kind === "cancel" && a.eventRef === b.eventRef);
}
function announce() { window.dispatchEvent(new Event(calendarOperationChangeEvent)); }
/** Call only while holding the independent calendar Web Lock. */
export function claimCalendarOperation(operation: CalendarOperation): "claimed" | "occupied" | "failed" {
  const slot = readCalendarOperationSlot();
  if (slot.kind === "operation") return sameCalendarOperation(slot.operation, operation) ? "claimed" : "occupied";
  if (slot.kind === "corrupt") return "occupied";
  if (slot.kind === "unreadable") return "failed";
  const raw = JSON.stringify(operation);
  try { window.localStorage.setItem(calendarOperationStorageKey, raw); } catch { return "failed"; }
  const verified = readCalendarOperationSnapshot() === raw;
  announce();
  return verified ? "claimed" : "failed";
}
/** Compare before removal AND verify removal; never delete another tab's operation. */
export function clearCalendarOperation(expected: CalendarOperation): "cleared" | "empty" | "different" | "failed" {
  const slot = readCalendarOperationSlot();
  if (slot.kind === "empty") return "empty";
  if (slot.kind === "unreadable") return "failed";
  if (slot.kind !== "operation" || !sameCalendarOperation(slot.operation, expected)) return "different";
  try { window.localStorage.removeItem(calendarOperationStorageKey); } catch { return "failed"; }
  const verified = readCalendarOperationSnapshot() === null;
  announce();
  return verified ? "cleared" : "failed";
}
export function calendarOperationIsCurrent(expected: CalendarOperation) {
  const slot = readCalendarOperationSlot();
  return slot.kind === "operation" && sameCalendarOperation(slot.operation, expected);
}

type LockManager = { request(name: string, options: { mode: "exclusive"; ifAvailable: true }, callback: (lock: unknown) => Promise<void>): Promise<unknown> };
export type CalendarLockResult<T> = { status: "held"; value: T } | { status: "busy" | "unavailable" };
export async function withCalendarOperationLock<T>(work: () => Promise<T>): Promise<CalendarLockResult<T>> {
  const locks = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks || typeof locks.request !== "function") return { status: "unavailable" };
  let settled: { value: T } | { error: unknown } | undefined;
  let ran = false;
  try {
    await locks.request(calendarOperationLockName, { mode: "exclusive", ifAvailable: true }, async lock => {
      if (!lock) return;
      ran = true;
      try { settled = { value: await work() }; } catch (error) { settled = { error }; }
    });
  } catch { if (!ran) return { status: "unavailable" }; }
  if (!ran) return { status: "busy" };
  if (!settled) return { status: "unavailable" };
  if ("error" in settled) throw settled.error;
  return { status: "held", value: settled.value };
}
export const calendarLockMessage = {
  busy: "Another calendar tab is working on a confirmation. Nothing was sent; try again when it finishes.",
  unavailable: "This browser cannot safely coordinate calendar tabs. Nothing was sent. Use a supported browser to change a reservation."
};
export function newCalendarKey() {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") throw new Error("This browser cannot safely start a confirmation.");
  return `calendar:${crypto.randomUUID()}`;
}
export async function calendarIdentityDigest(identity: CalendarMutationIdentity): Promise<string> {
  const normalized = identity.kind === "create"
    ? { kind: "create", request: normalizeCalendarCreateRequest(identity.request) }
    : { kind: "cancel", request: normalizeCalendarCancelRequest(identity.request) };
  if (typeof crypto === "undefined" || !crypto.subtle) throw new Error("This browser cannot safely preserve a confirmation for recovery.");
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(normalized)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function calendarOperationFor(identity: CalendarMutationIdentity): Promise<CalendarOperation> {
  const digest = await calendarIdentityDigest(identity);
  return identity.kind === "create" ? { version: 1, kind: "create", key: identity.request.idempotencyKey, digest }
    : { version: 1, kind: "cancel", eventRef: identity.request.eventRef, digest };
}
export async function calendarEventProvesCreate(event: CalendarEvent, expected: Extract<CalendarOperation, { kind: "create" }>) {
  const request = normalizeCalendarCreateRequest({ visitDate: event.visitDate, label: event.label,
    ...(event.notes ? { notes: event.notes } : {}), ...(event.confirmationSource ? { confirmationSource: event.confirmationSource, sourceRef: event.sourceRef } : {}), idempotencyKey: expected.key });
  return await calendarIdentityDigest({ kind: "create", request }) === expected.digest;
}

export type CalendarSegment = { cursor: string | null; endCursor: string | null };
export type CalendarTraversal = {
  range: CalendarRange; cutoff?: number; role?: CalendarRole; events: CalendarEvent[];
  segments: CalendarSegment[]; visited: string[];
};
export function startCalendarTraversal(range: CalendarRange): CalendarTraversal {
  return { range, events: [], segments: [{ cursor: null, endCursor: null }], visited: [] };
}
/** Pure traversal. Split pages have no accepted records and never establish exhaustion. */
export function acceptCalendarPage(state: CalendarTraversal, page: CalendarRangePage): CalendarTraversal {
  const current = state.segments[0];
  if (!current || page.range.from !== state.range.from || page.range.to !== state.range.to ||
      page.endCursor !== current.endCursor || (state.cutoff !== undefined && page.cutoff !== state.cutoff) ||
      (state.role && page.role !== state.role)) throw new Error("The calendar changed while loading. Refresh this range.");
  const visit = JSON.stringify(current);
  if (state.visited.includes(visit) || state.visited.length >= 4096) throw new Error("The calendar could not finish loading. Refresh this range.");
  let replacement: CalendarSegment[] = [];
  let accepted = state.events;
  if (page.pageStatus !== null) {
    const middle = page.splitCursor, end = page.continueCursor;
    if (!middle || !end || middle === end || middle === current.cursor || end === current.cursor || page.segmentDone || page.isDone) {
      throw new Error("The calendar could not finish loading. Refresh this range.");
    }
    replacement = [{ cursor: current.cursor, endCursor: middle }, { cursor: middle, endCursor: end }];
    if (end !== current.endCursor) replacement.push({ cursor: end, endCursor: current.endCursor });
  } else {
    const refs = new Set(state.events.map(event => event.eventRef));
    let lastDate = state.events.at(-1)?.visitDate;
    for (const event of page.events) {
      if (refs.has(event.eventRef) || (lastDate && event.visitDate < lastDate)) throw new Error("The calendar returned conflicting records. Refresh this range.");
      refs.add(event.eventRef); lastDate = event.visitDate;
    }
    accepted = [...state.events, ...page.events];
    if (!page.segmentDone) {
      if (!page.continueCursor || page.continueCursor === current.cursor) throw new Error("The calendar could not finish loading. Refresh this range.");
      replacement = [{ cursor: page.continueCursor, endCursor: current.endCursor }];
    } else if (current.endCursor === null && !page.isDone) throw new Error("The calendar result is incomplete. Refresh this range.");
  }
  const segments = [...replacement, ...state.segments.slice(1)];
  if (segments.some(segment => state.visited.includes(JSON.stringify(segment)))) throw new Error("The calendar could not finish loading. Refresh this range.");
  return { ...state, cutoff: page.cutoff, role: page.role, events: accepted, segments, visited: [...state.visited, visit] };
}
