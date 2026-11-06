// @vitest-environment happy-dom
// Synthetic lock/storage tests do not prove a real browser or Clerk authorization.
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptCalendarPage, calendarEventProvesCreate, calendarOperationChangeEvent, calendarOperationFor,
  calendarOperationLockName, calendarOperationStorageKey, claimCalendarOperation, clearCalendarOperation,
  parseCalendarOperationSnapshot, readCalendarOperationSlot, sameCalendarOperation, startCalendarTraversal,
  subscribeCalendarOperation, withCalendarOperationLock, type CalendarOperation
} from "./lib/calendar-recovery";
import { parseCalendarRangePage, type CalendarEvent, type CalendarRangePage } from "./lib/calendar-contract";

const range = { from: "2026-10-02", to: "2026-11-01" };
const create = { kind: "create" as const, request: { visitDate: "2026-10-03", label: "Synthetic reception", confirmationSource: "owner-confirmation" as const, sourceRef: "Synthetic owner note", notes: "Synthetic note", idempotencyKey: "calendar:abcdefghijkl" } };
const event: CalendarEvent = { eventRef: "PEV20261003-ABC123", visitDate: "2026-10-03", label: create.request.label,
  status: "confirmed", createdAt: 50, confirmationSource: "owner-confirmation", sourceRef: create.request.sourceRef, notes: create.request.notes };
const pointer: CalendarOperation = { version: 1, kind: "create", key: "calendar:abcdefghijkl", digest: "a".repeat(64) };
function page(extra: Partial<CalendarRangePage> = {}): CalendarRangePage {
  return { role: "admin", range, cutoff: 100, events: [], continueCursor: null, isDone: true, pageStatus: null, splitCursor: null, endCursor: null, segmentDone: true, ...extra };
}
function locks() {
  const held = new Set<string>();
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (name: string, options: unknown, callback: (lock: unknown) => Promise<void>) => {
    expect(options).toEqual({ mode: "exclusive", ifAvailable: true });
    if (held.has(name)) return callback(null);
    held.add(name); try { return await callback({ name }); } finally { held.delete(name); }
  } } });
}
beforeEach(() => { window.localStorage.clear(); vi.stubGlobal("crypto", webcrypto); locks(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (navigator as { locks?: unknown }).locks; });

describe("calendar operation durability and independent serialization", () => {
  it("stores only identity and matches a canonical normalized body after reload", async () => {
    const operation = await calendarOperationFor(create);
    await withCalendarOperationLock(async () => { expect(claimCalendarOperation(operation)).toBe("claimed"); });
    expect(readCalendarOperationSlot()).toEqual({ kind: "operation", operation });
    const raw = window.localStorage.getItem(calendarOperationStorageKey)!;
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["digest", "key", "kind", "version"]);
    for (const text of [create.request.label, create.request.notes, create.request.sourceRef, "Bearer", "email"]) expect(raw).not.toContain(text);
    expect(await calendarEventProvesCreate(event, operation as Extract<CalendarOperation, { kind: "create" }>)).toBe(true);
    expect(await calendarEventProvesCreate({ ...event, sourceRef: "Different confirmation" }, operation as Extract<CalendarOperation, { kind: "create" }>)).toBe(false);
    expect(await calendarOperationFor({ ...create, request: { ...create.request, label: ` ${create.request.label} ` } })).toEqual(operation);
  });
  it("refuses a second tab without queueing or overwriting the first pending identity", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = withCalendarOperationLock(async () => { expect(claimCalendarOperation(pointer)).toBe("claimed"); await gate; });
    const secondWork = vi.fn(async () => claimCalendarOperation({ ...pointer, key: "calendar:secondtababc" }));
    expect(await withCalendarOperationLock(secondWork)).toEqual({ status: "busy" });
    expect(secondWork).not.toHaveBeenCalled();
    expect(readCalendarOperationSlot()).toEqual({ kind: "operation", operation: pointer });
    release(); await first;
    await withCalendarOperationLock(async () => { expect(claimCalendarOperation({ ...pointer, key: "calendar:secondtababc" })).toBe("occupied"); });
    expect(readCalendarOperationSlot()).toEqual({ kind: "operation", operation: pointer });
    expect(calendarOperationLockName).not.toBe("skyla:pos-register-sale");
  });
  it("never clears or overwrites another operation even after a delayed first response", async () => {
    claimCalendarOperation(pointer);
    const replacement = { ...pointer, key: "calendar:replacement1" };
    window.localStorage.setItem(calendarOperationStorageKey, JSON.stringify(replacement));
    expect(clearCalendarOperation(pointer)).toBe("different");
    expect(claimCalendarOperation(pointer)).toBe("occupied");
    expect(readCalendarOperationSlot()).toEqual({ kind: "operation", operation: replacement });
  });
  it("does not treat missing storage or removal readback as verified cleanup", () => {
    claimCalendarOperation(pointer);
    const remove = vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => {});
    expect(clearCalendarOperation(pointer)).toBe("failed");
    remove.mockRestore();
    const get = vi.spyOn(window.localStorage, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readCalendarOperationSlot()).toEqual({ kind: "unreadable" });
    expect(claimCalendarOperation(pointer)).toBe("failed"); expect(clearCalendarOperation(pointer)).toBe("failed");
    get.mockRestore(); expect(clearCalendarOperation(pointer)).toBe("cleared");
  });
  it.each(["not-json", "{}", JSON.stringify({ ...pointer, email: "synthetic@example.invalid" }), JSON.stringify({ ...pointer, digest: "short" }), JSON.stringify({ ...pointer, key: "bad" })])("preserves corrupt storage: %s", raw => {
    window.localStorage.setItem(calendarOperationStorageKey, raw);
    expect(parseCalendarOperationSnapshot(raw).kind).toBe("corrupt");
    expect(claimCalendarOperation(pointer)).toBe("occupied"); expect(clearCalendarOperation(pointer)).toBe("different");
    expect(window.localStorage.getItem(calendarOperationStorageKey)).toBe(raw);
  });
  it("notifies same-window and relevant other-tab changes, excluding POS storage", () => {
    const change = vi.fn(); const dispose = subscribeCalendarOperation(change);
    window.dispatchEvent(new StorageEvent("storage", { key: "skyla:pos-active-sale" })); expect(change).not.toHaveBeenCalled();
    window.dispatchEvent(new StorageEvent("storage", { key: calendarOperationStorageKey }));
    window.dispatchEvent(new Event(calendarOperationChangeEvent)); expect(change).toHaveBeenCalledTimes(2);
    dispose(); window.dispatchEvent(new Event(calendarOperationChangeEvent)); expect(change).toHaveBeenCalledTimes(2);
  });
  it("refuses mutation work when locks are unavailable or cannot be acquired", async () => {
    delete (navigator as { locks?: unknown }).locks;
    const work = vi.fn(); expect(await withCalendarOperationLock(work)).toEqual({ status: "unavailable" }); expect(work).not.toHaveBeenCalled();
    Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async () => { throw new Error("unsupported"); } } });
    expect(await withCalendarOperationLock(work)).toEqual({ status: "unavailable" });
  });
});

describe("bounded native calendar traversal", () => {
  it("discards both kinds of split pages, recovers nested children and verifies outer exhaustion", () => {
    let state = startCalendarTraversal(range);
    state = acceptCalendarPage(state, page({ pageStatus: "SplitRecommended", splitCursor: "M", continueCursor: "E", segmentDone: false, isDone: false, events: [event] }));
    expect(state.events).toEqual([]); expect(state.segments).toEqual([{ cursor: null, endCursor: "M" }, { cursor: "M", endCursor: "E" }, { cursor: "E", endCursor: null }]);
    state = acceptCalendarPage(state, page({ endCursor: "M", pageStatus: "SplitRequired", splitCursor: "K", continueCursor: "M", isDone: false, segmentDone: false, events: [event] }));
    expect(state.events).toEqual([]);
    state = acceptCalendarPage(state, page({ endCursor: "K", isDone: false, events: [event] }));
    state = acceptCalendarPage(state, page({ endCursor: "M", isDone: false }));
    state = acceptCalendarPage(state, page({ endCursor: "E", isDone: false }));
    expect(state.segments).toEqual([{ cursor: "E", endCursor: null }]); expect(state.events).toEqual([event]);
    state = acceptCalendarPage(state, page()); expect(state.segments).toEqual([]);
  });
  it("advances empty non-final pages and retains both confirmed and cancelled records across more than100 rows", () => {
    let state = acceptCalendarPage(startCalendarTraversal(range), page({ isDone: false, segmentDone: false, continueCursor: "empty-next" }));
    expect(state.segments[0]?.cursor).toBe("empty-next");
    for (let index = 0; index < 5; index += 1) {
      const events = Array.from({ length: 25 }, (_, offset) => ({ ...event, eventRef: `PEV20261003-${String(index * 25 + offset).padStart(6, "0")}`,
        ...(offset % 2 ? { status: "cancelled" as const, cancelledAt: 80, cancelReason: "Synthetic reason" } : {}) }));
      state = acceptCalendarPage(state, page({ events, isDone: index === 4, segmentDone: index === 4, continueCursor: index === 4 ? null : `next-${index}` }));
    }
    expect(state.events).toHaveLength(125); expect(state.events.some(row => row.status === "cancelled")).toBe(true); expect(state.segments).toEqual([]);
  });
  it("rejects duplicate refs and backwards dates across accepted pages", () => {
    const state = acceptCalendarPage(startCalendarTraversal(range), page({ events: [event], isDone: false, segmentDone: false, continueCursor: "next" }));
    expect(() => acceptCalendarPage(state, page({ events: [event] }))).toThrow(/conflicting records/);
    const earlier = { ...event, visitDate: "2026-10-02", eventRef: "PEV20261002-ABC123" };
    expect(() => acceptCalendarPage(state, page({ events: [earlier] }))).toThrow(/conflicting records/);
  });
  it("rejects cutoff/role/range drift and cursor loops rather than accepting partial coverage", () => {
    const first = acceptCalendarPage(startCalendarTraversal(range), page({ isDone: false, segmentDone: false, continueCursor: "A" }));
    for (const wrong of [page({ cutoff: 101 }), page({ role: "viewer" }), page({ range: { ...range, to: "2026-11-02" } })]) expect(() => acceptCalendarPage(first, wrong)).toThrow();
    const second = acceptCalendarPage(first, page({ isDone: false, segmentDone: false, continueCursor: "B" }));
    expect(() => acceptCalendarPage(second, page({ isDone: false, segmentDone: false, continueCursor: "A" }))).toThrow();
    expect(() => acceptCalendarPage(first, page({ isDone: false, segmentDone: false, continueCursor: "A" }))).toThrow();
  });
  it("validates request-bound segment completion and selected-range freshness", () => {
    const state = startCalendarTraversal(range);
    expect(() => parseCalendarRangePage(page({ cutoff: 51, events: [{ ...event, createdAt: 52 }] }), range)).toThrow();
    expect(() => acceptCalendarPage(state, page({ isDone: false, segmentDone: true }))).toThrow();
    expect(sameCalendarOperation(pointer, { ...pointer, digest: "b".repeat(64) })).toBe(false);
  });
});
