import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addVisitDays } from "@skyla/payments";
import { ConvexError } from "convex/values";

import { createConvexHarness, type ConvexHarness } from "./convexHarness.testkit";
import * as privateEvents from "./privateEvents";
import {
  assertNewPrivateEventDate, decodePrivateEventCursor, encodePrivateEventCursor,
  normalizePrivateEventRange, normalizePrivateEventRef, normalizePrivateEventRequest,
  privateEventCancelFingerprint, privateEventFingerprint
} from "./lib/privateEvents";

const noon = Date.parse("2026-10-02T19:00:00.000Z");
const range = { from: "2026-10-02", to: "2026-10-31" };
type Event = {
  eventRef: string; visitDate: string; status: string; label: string;
  createdAt: number; cancelledAt?: number; cancelReason?: string;
  confirmationSource?: string; sourceRef?: string;
};
type Page = {
  role: string; range: typeof range; cutoff: number; events: Event[];
  continueCursor: string | null; isDone: boolean;
  pageStatus: "SplitRequired" | "SplitRecommended" | null;
  splitCursor: string | null; endCursor: string | null; segmentDone: boolean;
};
const request = (changes: Record<string, unknown> = {}) => ({
  visitDate: "2026-10-10", label: "Owner confirmed buyout", notes: "Lobby handoff",
  confirmationSource: "owner-confirmation", sourceRef: "Mike confirmation 2026-10-02",
  idempotencyKey: "private_calendar_request_0001", ...changes
});
function setup() {
  const h = createConvexHarness({ privateEvents });
  for (const role of ["admin", "viewer", "pos"]) h.seed("staffUsers", {
    subject: role, role, active: true, emailLower: `${role}@example.com`
  });
  return h;
}
function seedEvent(h: ConvexHarness, index: number, overrides: Record<string, unknown> = {}) {
  const visitDate = "2026-10-10";
  const body = { visitDate, label: `Event ${index}`, idempotencyKey: `legacy_event_${String(index).padStart(6, "0")}` };
  return h.seed("privateEvents", {
    ...body, eventRef: `PEV20261010-${String(index).padStart(6, "0")}`,
    requestFingerprint: privateEventFingerprint(body), status: "confirmed",
    createdBy: "staffUsers|seed-1", createdAt: 1, updatedAt: 1, ...overrides
  });
}
const read = (h: ConvexHarness, args: Record<string, unknown> = {}, as = "viewer") =>
  h.call<Page>(privateEvents.listPrivateEventsRange, { ...range, ...args }, as);
async function exhaust(h: ConvexHarness, args: Record<string, unknown> = {}) {
  const events: Event[] = [];
  const pages: Page[] = [];
  const visit = async (cursor: string | null, endCursor?: string | null): Promise<void> => {
    for (let step = 0; step < 1000; step++) {
      const page = await read(h, { ...args, cursor, ...(endCursor ? { endCursor } : {}) });
      pages.push(page);
      if (page.pageStatus) {
        expect(page.isDone).toBe(false);
        expect(page.segmentDone).toBe(false);
        expect(page.continueCursor).not.toBeNull();
        expect(page.splitCursor).not.toBeNull();
        // SplitRequired page contents may be incomplete: only child reads count.
        await visit(cursor, page.splitCursor);
        await visit(page.splitCursor, page.continueCursor);
        cursor = page.continueCursor;
        continue;
      }
      events.push(...page.events);
      if (endCursor && page.segmentDone) {
        expect(page.isDone).toBe(false);
        expect(page.endCursor).toBe(endCursor);
        return;
      }
      if (!endCursor && page.isDone) {
        expect(page.segmentDone).toBe(true);
        return;
      }
      expect(page.continueCursor).not.toBeNull();
      expect(page.continueCursor).not.toBe(cursor);
      cursor = page.continueCursor;
    }
    throw new Error("Calendar traversal did not terminate");
  };
  await visit(null);
  return { events, pages };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(noon); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("private event source and exact operation recovery", () => {
  it("proves exact typed rejection and atomic rollback after a write but before successful create response", async () => {
    const h = setup();
    const insert = h.ctx.db.insert.bind(h.ctx.db);
    vi.spyOn(h.ctx.db, "insert").mockImplementation(async (table, doc) => {
      if (table === "auditEvents") throw new Error("Audit unavailable");
      return insert(table, doc);
    });
    const error = await h.call(privateEvents.createPrivateEvent, request(), "admin").catch(error => error);
    expect(error).toBeInstanceOf(ConvexError);
    if (!(error instanceof ConvexError)) throw error;
    expect(error.data).toEqual({ kind: "private_event_rejected", version: 1, operation: "create",
      lookup: { key: request().idempotencyKey }, requestFingerprint: privateEventFingerprint(request()), message: "Audit unavailable" });
    expect(h.rows("privateEvents")).toHaveLength(0);
    expect(h.rows("auditEvents")).toHaveLength(0);
  });

  it("proves exact typed cancellation rollback without changing the first recorded event", async () => {
    const h = setup();
    const created = await h.call<{ event: Event }>(privateEvents.createPrivateEvent, request(), "admin");
    const before = structuredClone(h.rows("privateEvents"));
    const insert = h.ctx.db.insert.bind(h.ctx.db);
    vi.spyOn(h.ctx.db, "insert").mockImplementation(async (table, doc) => {
      if (table === "auditEvents") throw new Error("Audit unavailable");
      return insert(table, doc);
    });
    const body = { eventRef: created.event.eventRef, reason: "Client postponed" };
    const error = await h.call(privateEvents.cancelPrivateEvent, body, "admin").catch(error => error);
    expect(error).toBeInstanceOf(ConvexError);
    if (!(error instanceof ConvexError)) throw error;
    expect(error.data).toEqual({ kind: "private_event_rejected", version: 1, operation: "cancel",
      lookup: { eventRef: body.eventRef }, requestFingerprint: privateEventCancelFingerprint(body), message: "Audit unavailable" });
    expect(h.rows("privateEvents")).toEqual(before);
    expect(h.rows("auditEvents")).toHaveLength(1);
  });

  it("types normalized permission rejection before event reads but leaves malformed identity untyped", async () => {
    const h = setup();
    const queries = vi.spyOn(h.ctx.db, "query");
    const error = await h.call(privateEvents.createPrivateEvent, request(), "viewer").catch(error => error);
    expect(error).toBeInstanceOf(ConvexError);
    if (!(error instanceof ConvexError)) throw error;
    expect(error.data).toMatchObject({ operation: "create", lookup: { key: request().idempotencyKey }, requestFingerprint: privateEventFingerprint(request()) });
    expect(queries.mock.calls.map(call => call[0])).toEqual(["staffUsers"]);
    const invalid = await h.call(privateEvents.createPrivateEvent, request({ idempotencyKey: "bad" }), "admin").catch(error => error);
    expect(invalid).not.toBeInstanceOf(ConvexError);
    expect(h.rows("privateEvents")).toHaveLength(0);
    expect(h.rows("auditEvents")).toHaveLength(0);
  });

  it("requires canonical human provenance for new records and records one audit", async () => {
    const h = setup();
    for (const invalid of [
      { confirmationSource: undefined, sourceRef: undefined },
      { confirmationSource: "inquiry", sourceRef: "lead" },
      { confirmationSource: "owner-confirmation", sourceRef: " " },
      { confirmationSource: undefined, sourceRef: "Mike" },
      { sourceRef: "x".repeat(201) }
    ]) await expect(h.call(privateEvents.createPrivateEvent, request(invalid), "admin")).rejects.toThrow();
    expect(h.rows("privateEvents")).toHaveLength(0);
    const body = request({ label: "  Buyout  ", notes: "  Lobby  ", sourceRef: "  Mike  " });
    const created = await h.call<{ role: string; reused: boolean; event: Event }>(privateEvents.createPrivateEvent, body, "admin");
    expect(created).toMatchObject({ role: "admin", reused: false, event: {
      label: "Buyout", confirmationSource: "owner-confirmation", sourceRef: "Mike", notes: "Lobby"
    } });
    expect(h.rows("privateEvents")[0].requestFingerprint).toBe('v2:["2026-10-10","Buyout","Lobby","owner-confirmation","Mike"]');
    expect(h.rows("auditEvents")).toEqual([expect.objectContaining({
      action: "privateEvent.create", metadata: expect.objectContaining({ confirmationSource: "owner-confirmation", sourceRef: "Mike" })
    })]);
    await expect(h.call(privateEvents.createPrivateEvent, body, "admin")).resolves.toMatchObject({ reused: true, event: created.event });
    for (const changed of [{ sourceRef: "Other booking" }, { confirmationSource: "booking-record" }, { label: "Changed" }]) {
      await expect(h.call(privateEvents.createPrivateEvent, { ...body, ...changed }, "admin")).rejects.toThrow("already used");
    }
    expect(h.rows("auditEvents")).toHaveLength(1);
  });

  it("replays both legacy and v2 requests after LA midnight without inventing source or reactivation", async () => {
    const h = setup();
    vi.setSystemTime(Date.parse("2026-10-03T06:59:59Z")); // LA Oct 2, 23:59:59
    const legacy = { visitDate: "2026-10-02", label: "Legacy confirmed", idempotencyKey: "legacy_midnight_key_0001" };
    seedEvent(h, 10, { ...legacy, eventRef: "PEV20261002-000010", requestFingerprint: privateEventFingerprint(legacy) });
    const modern = request({ visitDate: "2026-10-03" });
    const created = await h.call<{ event: Event }>(privateEvents.createPrivateEvent, modern, "admin");
    await h.call(privateEvents.cancelPrivateEvent, { eventRef: created.event.eventRef, reason: "Client postponed" }, "admin");
    vi.setSystemTime(Date.parse("2026-10-04T07:00:01Z"));
    await expect(h.call(privateEvents.createPrivateEvent, legacy, "admin")).resolves.toMatchObject({ reused: true, event: { visitDate: "2026-10-02" } });
    expect(h.rows("privateEvents")[0].confirmationSource).toBeUndefined();
    await expect(h.call(privateEvents.createPrivateEvent, { ...legacy, confirmationSource: "owner-confirmation", sourceRef: "Guessed" }, "admin")).rejects.toThrow("already used");
    await expect(h.call(privateEvents.createPrivateEvent, modern, "admin")).resolves.toMatchObject({ reused: true, event: { status: "cancelled", cancelReason: "Client postponed" } });
    await expect(h.call(privateEvents.createPrivateEvent, request({ visitDate: "2026-10-03", idempotencyKey: "new_past_key_0001" }), "admin")).rejects.toThrow("today or later");
    expect(h.rows("auditEvents")).toHaveLength(2);
  });

  it("retains first cancellation source/reason/audit and returns exact lookup identity", async () => {
    const h = setup();
    const created = await h.call<{ event: Event }>(privateEvents.createPrivateEvent, request(), "admin");
    const cancelled = await h.call(privateEvents.cancelPrivateEvent, { eventRef: created.event.eventRef, reason: "  Client postponed  " }, "admin");
    await expect(h.call(privateEvents.cancelPrivateEvent, { eventRef: created.event.eventRef, reason: "Different reason" }, "admin")).resolves.toMatchObject({ reused: true, event: { cancelReason: "Client postponed", sourceRef: request().sourceRef } });
    expect(cancelled).toMatchObject({ role: "admin", reused: false });
    expect(h.rows("auditEvents").map(row => row.action)).toEqual(["privateEvent.create", "privateEvent.cancel"]);
    expect(h.rows("privateEvents")).toHaveLength(1);
    await expect(h.call(privateEvents.getPrivateEventOperation, { idempotencyKey: ` ${request().idempotencyKey} ` }, "viewer")).resolves.toMatchObject({ role: "viewer", lookup: { key: request().idempotencyKey }, event: { eventRef: created.event.eventRef, status: "cancelled" } });
    await expect(h.call(privateEvents.getPrivateEventOperation, { eventRef: created.event.eventRef }, "admin")).resolves.toMatchObject({ role: "admin", lookup: { eventRef: created.event.eventRef }, event: { cancelReason: "Client postponed" } });
    await expect(h.call(privateEvents.getPrivateEventOperation, { idempotencyKey: "not_found_key_0001" }, "viewer")).resolves.toMatchObject({ event: null, lookup: { key: "not_found_key_0001" } });
    for (const args of [{}, { idempotencyKey: request().idempotencyKey, eventRef: created.event.eventRef }]) {
      await expect(h.call(privateEvents.getPrivateEventOperation, args, "viewer")).rejects.toThrow("exactly one");
    }
  });

  it("enforces genuine role boundaries on every new read and mutation", async () => {
    const h = setup();
    for (const as of ["pos", undefined]) {
      await expect(h.call(privateEvents.listPrivateEventsRange, range, as)).rejects.toThrow("Staff");
      await expect(h.call(privateEvents.getPrivateEventOperation, { idempotencyKey: request().idempotencyKey }, as)).rejects.toThrow("Staff");
    }
    await expect(read(h, {}, "admin")).resolves.toMatchObject({ role: "admin", isDone: true });
    await expect(read(h)).resolves.toMatchObject({ role: "viewer", isDone: true });
    for (const as of ["viewer", "pos", undefined]) {
      await expect(h.call(privateEvents.createPrivateEvent, request(), as)).rejects.toThrow("Staff");
      await expect(h.call(privateEvents.cancelPrivateEvent, { eventRef: "PEV20261010-000001", reason: "Cancelled" }, as)).rejects.toThrow("Staff");
    }
  });

  it("serializes identical creates and competing date confirmations without duplicate audit", async () => {
    const h = setup();
    const identical = await Promise.all([h.call(privateEvents.createPrivateEvent, request(), "admin"), h.call(privateEvents.createPrivateEvent, request(), "admin")]);
    expect(identical).toEqual([expect.objectContaining({ reused: false }), expect.objectContaining({ reused: true })]);
    await expect(h.call(privateEvents.createPrivateEvent, request({ idempotencyKey: "other_date_key_0001" }), "admin")).rejects.toThrow("existing confirmed");
    expect(h.rows("privateEvents")).toHaveLength(1);
    expect(h.rows("auditEvents")).toHaveLength(1);
  });

  it("fails closed on duplicate identities, inconsistent fingerprint, and generated reference collision", async () => {
    const h = setup();
    const legacy = { visitDate: "2026-10-10", label: "Original", idempotencyKey: "corrupt_body_key_0001" };
    seedEvent(h, 20, { ...legacy, label: "Changed stored body", requestFingerprint: privateEventFingerprint(legacy) });
    await expect(h.call(privateEvents.createPrivateEvent, legacy, "admin")).rejects.toThrow("already used");
    seedEvent(h, 21, { idempotencyKey: legacy.idempotencyKey });
    await expect(h.call(privateEvents.getPrivateEventOperation, { idempotencyKey: legacy.idempotencyKey }, "viewer")).rejects.toThrow("ambiguous");
    const collision = setup();
    // Three staff seeds + this seed make the next inserted id end 000005.
    seedEvent(collision, 5, { status: "cancelled", cancelledAt: 2, cancelReason: "Prior cancelled event" });
    await expect(collision.call(privateEvents.createPrivateEvent, request(), "admin")).rejects.toThrow("Generated private event reference is ambiguous");
    expect(collision.rows("privateEvents")).toHaveLength(1);
    expect(collision.rows("auditEvents")).toHaveLength(0); // insertion rolled back atomically
    const duplicateRef = setup();
    seedEvent(duplicateRef, 30); seedEvent(duplicateRef, 30, { idempotencyKey: "different_ref_key_0001" });
    await expect(read(duplicateRef)).rejects.toThrow("identity is ambiguous");
    await expect(duplicateRef.call(privateEvents.cancelPrivateEvent, { eventRef: "PEV20261010-000030", reason: "Cancel" }, "admin")).rejects.toThrow("ambiguous");
  });

  it("requires both aliases to resolve uniquely before key recovery or replay", async () => {
    const h = setup();
    seedEvent(h, 31);
    seedEvent(h, 31, { idempotencyKey: "different_event_key_0001" });
    const before = structuredClone(h.rows("privateEvents"));
    await expect(h.call(privateEvents.getPrivateEventOperation, { idempotencyKey: "legacy_event_000031" }, "viewer")).rejects.toThrow("identity is ambiguous");
    await expect(h.call(privateEvents.createPrivateEvent, { visitDate: "2026-10-10", label: "Event 31", idempotencyKey: "legacy_event_000031" }, "admin")).rejects.toThrow("identity is ambiguous");
    expect(h.rows("privateEvents")).toEqual(before);
    expect(h.rows("auditEvents")).toHaveLength(0);
  });

  it("blocks duplicate keys even when eventRef recovery or cancellation finds one row", async () => {
    const h = setup();
    seedEvent(h, 41); seedEvent(h, 42, { idempotencyKey: "legacy_event_000041" });
    const before = structuredClone(h.rows("privateEvents"));
    await expect(h.call(privateEvents.getPrivateEventOperation, { eventRef: "PEV20261010-000041" }, "viewer")).rejects.toThrow("identity is ambiguous");
    await expect(h.call(privateEvents.cancelPrivateEvent, { eventRef: "PEV20261010-000041", reason: "Cancel" }, "admin")).rejects.toThrow("identity is ambiguous");
    await expect(read(h)).rejects.toThrow("identity is ambiguous");
    expect(h.rows("privateEvents")).toEqual(before);
    expect(h.rows("auditEvents")).toHaveLength(0);
  });

  it("rejects malformed stored keys rather than presenting an unrecoverable event identity", async () => {
    const h = setup(); seedEvent(h, 51, { idempotencyKey: " legacy_event_000051 " });
    await expect(h.call(privateEvents.getPrivateEventOperation, { eventRef: "PEV20261010-000051" }, "viewer")).rejects.toThrow("identity needs reconciliation");
    await expect(read(h)).rejects.toThrow("identity needs reconciliation");
    expect(h.rows("auditEvents")).toHaveLength(0);
  });
});

describe("complete bounded calendar traversal", () => {
  it("loads over 100 records with same-date ties and both statuses exactly once", async () => {
    const h = setup();
    for (let index = 1; index <= 137; index++) seedEvent(h, index, index % 2 ? {} : { status: "cancelled", cancelledAt: 2, cancelReason: "Cancelled fixture" });
    seedEvent(h, 900, { visitDate: range.from, eventRef: "PEV20261002-000900" });
    seedEvent(h, 901, { visitDate: range.to, eventRef: "PEV20261031-000901" });
    seedEvent(h, 902, { visitDate: "2026-11-01", eventRef: "PEV20261101-000902" });
    const { events, pages } = await exhaust(h);
    expect(events).toHaveLength(139);
    expect(new Set(events.map(event => event.eventRef)).size).toBe(139);
    expect(events[0].visitDate).toBe(range.from);
    expect(events.at(-1)?.visitDate).toBe(range.to);
    expect(events.filter(event => event.status === "cancelled")).toHaveLength(68);
    expect(pages.at(-1)).toMatchObject({ isDone: true, segmentDone: true, continueCursor: null });
    expect(new Set(pages.map(page => page.cutoff)).size).toBe(1);
  });

  it("keeps membership fixed by native creation time while returning fresh cancellation facts", async () => {
    const h = setup();
    for (let index = 1; index <= 40; index++) seedEvent(h, index);
    const first = await read(h);
    vi.setSystemTime(noon + 1000);
    // A legacy business timestamp cannot override authoritative creation membership.
    seedEvent(h, 800, { visitDate: range.from, eventRef: "PEV20261002-000800", createdAt: 1, _creationTime: noon + 1000 });
    // Select a record beyond the actual same-date native cursor, not its numeric display reference.
    const pendingRef = h.rows("privateEvents").find(row => !first.events.some(event => event.eventRef === row.eventRef) && row.eventRef !== "PEV20261002-000800")!.eventRef as string;
    await h.call(privateEvents.cancelPrivateEvent, { eventRef: pendingRef, reason: "Changed between pages" }, "admin");
    const second = await read(h, { cursor: first.continueCursor });
    expect(second.cutoff).toBe(first.cutoff);
    expect([...first.events, ...second.events]).toHaveLength(40);
    expect(second.events.find(event => event.eventRef === pendingRef)).toMatchObject({ status: "cancelled", cancelReason: "Changed between pages" });
    expect(second.events.some(event => event.eventRef.endsWith("000800"))).toBe(false);
    const refreshed = await exhaust(h);
    expect(refreshed.events).toHaveLength(41);
  });

  it("splits read-budget-limited sparse ranges and never counts incomplete split pages", async () => {
    const h = setup();
    for (let index = 1; index <= 25; index++) seedEvent(h, index, { visitDate: range.from, eventRef: `PEV20261002-${String(index).padStart(6, "0")}` });
    for (let index = 26; index <= 40; index++) seedEvent(h, index);
    const first = await read(h);
    vi.setSystemTime(noon + 1000);
    for (let index = 1; index <= 205; index++) seedEvent(h, 1000 + index, { visitDate: "2026-10-05", eventRef: `PEV20261005-${String(1000 + index).padStart(6, "0")}`, createdAt: noon + 1000, _creationTime: noon + 1000 });
    const split = await read(h, { cursor: first.continueCursor });
    expect(split).toMatchObject({ pageStatus: "SplitRequired", events: [], isDone: false, segmentDone: false });
    const collected: Event[] = [...first.events];
    const pending = [{ cursor: first.continueCursor, endCursor: null as string | null }];
    let splitCount = 0;
    for (let step = 0; pending.length && step < 100; step++) {
      const segment = pending.shift()!;
      const page = await read(h, segment);
      if (page.pageStatus) {
        splitCount++;
        // Resume original interval after recovering its two bounded children.
        pending.unshift(
          { cursor: segment.cursor, endCursor: page.splitCursor },
          { cursor: page.splitCursor, endCursor: page.continueCursor },
          { cursor: page.continueCursor, endCursor: segment.endCursor }
        );
      } else {
        collected.push(...page.events);
        if (!(segment.endCursor ? page.segmentDone : page.isDone)) pending.unshift({ ...segment, cursor: page.continueCursor });
      }
    }
    expect(pending).toHaveLength(0);
    expect(splitCount).toBeGreaterThan(0);
    expect(collected).toHaveLength(40);
    expect(new Set(collected.map(event => event.eventRef)).size).toBe(40);
    expect(collected.every(event => !event.eventRef.startsWith("PEV20261005"))).toBe(true);
  });

  it("supports empty bounded segments and binds cursors to range/cutoff/native query", async () => {
    const h = setup();
    for (let index = 1; index <= 30; index++) seedEvent(h, index);
    const page = await read(h);
    await expect(read(h, { cursor: page.continueCursor, endCursor: page.continueCursor })).resolves.toMatchObject({ events: [], isDone: false, segmentDone: true, continueCursor: null, endCursor: page.continueCursor });
    const bounded = await read(h, { endCursor: page.continueCursor });
    expect(bounded).toMatchObject({ events: page.events, cutoff: page.cutoff, isDone: false, segmentDone: true });
    for (const invalid of ["", "pev1.%", "\u0000", "x".repeat(8193)]) {
      await expect(read(h, { cursor: invalid })).rejects.toThrow("cursor is invalid");
      await expect(read(h, { endCursor: invalid })).rejects.toThrow("cursor is invalid");
    }
    await expect(read(h, { from: "2026-10-03", cursor: page.continueCursor })).rejects.toThrow("cursor is invalid");
    vi.setSystemTime(noon + 1);
    const later = encodePrivateEventCursor(range, noon + 1, decodePrivateEventCursor(page.continueCursor!, range, noon).native);
    await expect(read(h, { cursor: page.continueCursor, endCursor: later })).rejects.toThrow("different cutoffs");
    await expect(read(h, { cursor: later })).rejects.toThrow("InvalidCursor");
  });

  it.each([
    { confirmationSource: "owner-confirmation" },
    { sourceRef: "Partial provenance" },
    { status: "cancelled", cancelledAt: 2 },
    { status: "confirmed", cancelReason: "Corrupt" },
    { eventRef: "PEV20260230-000001" },
    { eventRef: "PEV20261010-000001 " },
    { eventRef: "PEV20261011-000001" }
  ])("blocks malformed legacy projection instead of implying verified coverage: %j", async overrides => {
    const h = setup(); seedEvent(h, 1, overrides);
    await expect(read(h)).rejects.toThrow();
    await expect(h.call(privateEvents.getPrivateEventOperation, { idempotencyKey: "legacy_event_000001" }, "viewer")).rejects.toThrow();
  });
  it("rejects a business creation timestamp beyond the membership cutoff", async () => {
    const h = setup(); seedEvent(h, 1, { createdAt: noon + 1000 });
    await expect(read(h)).rejects.toThrow("creation facts exceed");
  });
});

describe("calendar date and syntax boundaries", () => {
  it("uses Los Angeles midnight and DST dates for new events while syntax-only legacy requests remain recoverable", () => {
    const beforeMidnight = Date.parse("2026-10-03T06:59:59Z");
    const afterMidnight = Date.parse("2026-10-03T07:00:00Z");
    expect(() => assertNewPrivateEventDate("2026-10-02", beforeMidnight)).not.toThrow();
    expect(() => assertNewPrivateEventDate("2026-10-02", afterMidnight)).toThrow("today or later");
    expect(normalizePrivateEventRequest({ visitDate: "2026-10-02", label: "Legacy", idempotencyKey: "legacy_date_key_0001" })).toMatchObject({ visitDate: "2026-10-02" });
    expect(() => assertNewPrivateEventDate("2026-11-01", Date.parse("2026-11-02T07:59:59Z"))).not.toThrow(); // Nov 1 23:59 PST
    expect(() => assertNewPrivateEventDate("2026-11-01", Date.parse("2026-11-02T08:00:00Z"))).toThrow();
    expect(() => assertNewPrivateEventDate(addVisitDays("2026-10-02", 1095), noon)).not.toThrow();
    expect(() => assertNewPrivateEventDate(addVisitDays("2026-10-02", 1096), noon)).toThrow("within 1095");
  });
  it("accepts leap dates and inclusive 366-day ranges, rejects invalid dates/reference dates", () => {
    expect(normalizePrivateEventRange("2028-02-29", "2028-02-29")).toEqual({ from: "2028-02-29", to: "2028-02-29" });
    expect(() => normalizePrivateEventRange("2026-01-01", "2027-01-01")).not.toThrow();
    for (const pair of [["2026-02-29", "2026-03-01"], ["2026-10-10", "2026-10-09"], ["2026-01-01", "2027-01-02"]]) expect(() => normalizePrivateEventRange(...pair as [string, string])).toThrow();
    expect(() => normalizePrivateEventRef("PEV20260230-ABCDEF")).toThrow("date is invalid");
    expect(normalizePrivateEventRef("PEV20280229-ABCDEF")).toBe("PEV20280229-ABCDEF");
  });
});
