import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConvexError } from "convex/values";
import type { BillingExceptionPage } from "@skyla/payments";
import { createConvexHarness } from "./convexHarness.testkit";
import * as operationsExceptions from "./operationsExceptions";
import { parseBillingExceptionPage } from "../apps/web/lib/billing-contract";
import { decodeBillingCursor, encodeBillingCursor } from "./lib/billingDetails";

const now = 1_800_000_000_000;
type Raw = Record<string, unknown> & { _id: string; _creationTime: number };
type Predicate = (row: Raw) => boolean;
type Options = { numItems: number; cursor: string | null; endCursor?: string; maximumRowsRead: number; maximumBytesRead: number };
/** Test-local synthetic pagination. Actual opaque SDK/native behavior remains root's proof gate. */
function setup() {
  const h = createConvexHarness({ operationsExceptions });
  h.seed("staffUsers", { subject: "admin", emailLower: "SECRET_EMAIL", role: "admin", active: true });
  h.seed("staffUsers", { subject: "viewer", role: "viewer", active: true });
  const calls: Options[] = []; const realQuery = h.ctx.db.query.bind(h.ctx.db);
  h.ctx.db.query = ((table: string) => {
    if (table !== "operationsExceptions") return realQuery(table);
    const base = realQuery(table);
    return { ...base, filter(build: (q: unknown) => Predicate) {
      const predicate = build({ field: (key: string) => key, eq: (key: string, value: unknown) => (row: Raw) => row[key] === value,
        lte: (key: string, value: number) => (row: Raw) => Number(row[key]) <= value, and: (...terms: Predicate[]) => (row: Raw) => terms.every(term => term(row)) });
      return { order(direction: string) {
        if (direction !== "desc") throw new Error("wrong direction");
        return { async paginate(options: Options) {
          calls.push(options);
          const encode = (row: Raw | undefined) => JSON.stringify({ key: row ? [row._creationTime, row._id] : null });
          const decode = (cursor: string | null | undefined) => cursor ? (JSON.parse(cursor) as { key: [number, string] | null }).key : undefined;
          const start = decode(options.cursor), end = decode(options.endCursor);
          const compare = (row: Raw, key: [number, string]) => row._creationTime === key[0] ? row._id === key[1] ? 0 : row._id > key[1] ? -1 : 1 : row._creationTime > key[0] ? -1 : 1;
          const all = (h.rows(table) as Raw[]).toSorted((a, b) => b._creationTime - a._creationTime || (a._id > b._id ? -1 : 1));
          const candidates = start === null ? [] : all.filter(row => (!start || compare(row, start) > 0) && (!end || compare(row, end) <= 0));
          const scanned: Raw[] = [], page: Raw[] = []; let bytes = 0, truncated = false;
          for (const row of candidates) {
            const size = JSON.stringify(row).length;
            if (scanned.length >= options.maximumRowsRead || bytes + size > options.maximumBytesRead) { truncated = true; break; }
            scanned.push(row); bytes += size; if (predicate(row)) page.push(row);
            if (!options.endCursor && page.length >= options.numItems) break;
          }
          const exhausted = scanned.length === candidates.length;
          const continueCursor = options.endCursor && (exhausted || truncated) ? options.endCursor : exhausted ? encode(undefined) : encode(scanned.at(-1));
          return { page, continueCursor, isDone: !options.endCursor && exhausted,
            pageStatus: truncated ? "SplitRequired" : null, splitCursor: truncated && scanned.length > 1 ? encode(scanned[Math.floor(scanned.length / 2) - 1]) : null };
        } };
      } };
    } };
  }) as typeof h.ctx.db.query;
  const seed = (status = "open", created = now - 1000, fields: Record<string, unknown> = {}) => h.seed("operationsExceptions", {
    _creationTime: created, status, category: "billing", code: "paid_sale_capacity_exception", moneyReceived: true, saleRef: "SALE261002-ABCDEF",
    ...(status === "resolved" ? { resolvedAt: now } : {}), amountCents: 3000, currency: "usd", occurrenceCount: 1, firstSeenAt: now - 1000, lastSeenAt: now - 1000, createdAt: now - 1000, dedupeKey: "SECRET_DEDUPE", evidence: { SECRET_RAW: "SECRET_PAYLOAD" }, ...fields
  });
  const read = async (args: Record<string, unknown> = {}, as = "admin") => {
    const request = { status: "open" as const, limit: 25, cursor: null as string | null, endCursor: null as string | null, ...args };
    return parseBillingExceptionPage(await h.call<BillingExceptionPage>(operationsExceptions.listOperationsExceptionsPage, request, as), request);
  };
  return { h, calls, seed, read };
}
async function typed(promise: Promise<unknown>) { try { await promise; throw new Error("expected error"); } catch (error) { expect(error).toBeInstanceOf(ConvexError); return (error as ConvexError<string>).data; } }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function exhaust(f: ReturnType<typeof setup>) {
  const ids: string[] = []; let steps = 0; let cursor: string | null = null;
  const segment = async (start: string | null, endCursor: string) => {
    if (++steps > 50) throw new Error("loop");
    const page = await f.read({ cursor: start, endCursor });
    if (page.pageStatus) { expect(page.segmentDone).toBe(false); await segment(start, page.splitCursor!); await segment(page.splitCursor!, page.continueCursor!); }
    else { expect(page.segmentDone).toBe(true); expect(page.isDone).toBe(false); expect(page.continueCursor).toBeNull(); ids.push(...page.page.map(row => row.exceptionId)); }
  };
  for (;;) {
    if (++steps > 50) throw new Error("loop");
    const page = await f.read({ cursor });
    if (page.pageStatus) { await segment(cursor, page.splitCursor!); await segment(page.splitCursor!, page.continueCursor!); }
    else ids.push(...page.page.map(row => row.exceptionId));
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  return ids;
}

describe("bounded immutable native exception pagination", () => {
  it("130 equal native creation times exhaust exactly once with native tie order", async () => {
    const f = setup(); for (let i = 0; i < 130; i++) f.seed("open", now - 1000 + 0.25);
    const expected = (f.h.rows("operationsExceptions") as Raw[]).toSorted((a, b) => a._id > b._id ? -1 : 1).map(row => row._id);
    const ids = await exhaust(f); expect(ids).toEqual(expected); expect(new Set(ids).size).toBe(130);
    expect(f.calls.every(call => call.maximumRowsRead === 100 && call.maximumBytesRead === 256 * 1024 && call.numItems === 25)).toBe(true);
    expect(f.h.scheduled).toEqual([]);
  });
  it("sparse matching rows force genuine synthetic split/empty advance without duplicate or skip", async () => {
    const f = setup(); const expected: string[] = [];
    for (let i = 0; i < 250; i++) { const id = f.seed(i === 120 || i === 240 ? "open" : "resolved", now - i - 1); if (i === 120 || i === 240) expected.push(id); }
    const first = await f.read(); expect(first.page).toEqual([]); expect(first.pageStatus).toBe("SplitRequired"); expect(first.continueCursor).not.toBeNull(); expect(first.splitCursor).not.toBeNull();
    expect(await exhaust(f)).toEqual(expected);
  });
  it("new creation after cutoff is excluded while mutable status beyond cursor needs reload", async () => {
    const f = setup(); for (let i = 0; i < 40; i++) f.seed("open", now - i - 1);
    const first = await f.read(); const late = f.seed("open", now + 0.25); const changed = f.h.rows("operationsExceptions")[0]; changed.status = "resolved";
    const next = await f.read({ cursor: first.continueCursor }); expect(next.page.map(row => row.exceptionId)).not.toContain(late); expect(next.cutoff).toBe(first.cutoff); expect(next.isDone).toBe(true);
    vi.setSystemTime(now + 1); const refreshed = await f.read(); expect(refreshed.page.map(row => row.exceptionId)).toContain(late); expect(refreshed.page.map(row => row.exceptionId)).not.toContain(changed._id);
  });
  it("resolved recurrence remains separately selectable and native creation ignores legacycreatedAt", async () => {
    const f = setup(); const resolved = f.seed("resolved", now - 5, { createdAt: now + 999, dedupeKey: "same-series" }); const open = f.seed("open", now - 1, { createdAt: 1, dedupeKey: "same-series" });
    expect((await f.read()).page.map(row => row.exceptionId)).toEqual([open]); expect((await f.read({ status: "resolved" })).page.map(row => row.exceptionId)).toEqual([resolved]);
    expect(JSON.stringify(await f.read())).not.toContain("same-series");
  });
  it("bounded end cursor derives cutoff from bound; equal bounds are a legal complete empty segment", async () => {
    const f = setup(); for (let i = 0; i < 40; i++) f.seed("open", now - i - 1); const first = await f.read();
    const bounded = await f.read({ endCursor: first.continueCursor }); expect(bounded.cutoff).toBe(first.cutoff); expect(bounded.segmentDone).toBe(true); expect(bounded.isDone).toBe(false); expect(bounded.page).toHaveLength(25);
    const empty = await f.read({ cursor: first.continueCursor, endCursor: first.continueCursor }); expect(empty.page).toEqual([]); expect(empty.segmentDone).toBe(true); expect(empty.capped).toBe(true);
  });
  it.each(["", "pev1.fake", "x".repeat(8193), "bex1.%zz", "bex1.\ncontrol"])("rejects invalid cursor without querying native %s", async cursor => {
    const f = setup(); expect(await typed(f.read({ cursor }))).toMatchObject({ code: "billing_cursor_invalid" }); expect(f.calls).toEqual([]);
  });
  it("rejects changed status/limit/cutoff/version/direction/extra fields", async () => {
    const f = setup(); const valid = encodeBillingCursor({ status: "open", limit: 25 }, now, "native");
    for (const args of [{ status: "resolved" }, { limit: 50 }]) expect(await typed(f.read({ cursor: valid, ...args }))).toMatchObject({ code: "billing_cursor_invalid" });
    const decoded = decodeBillingCursor(valid, { status: "open", limit: 25 }, now);
    for (const changed of [{ cutoff: now + 1 }, { direction: "asc" }, { version: 2 }, { SECRET_EXTRA: "canary" }]) {
      const cursor = `bex1.${encodeURIComponent(JSON.stringify({ ...decoded, ...changed }))}`; expect(await typed(f.read({ cursor }))).toMatchObject({ code: "billing_cursor_invalid" });
    }
    const otherCutoff = encodeBillingCursor({ status: "open", limit: 25 }, now - 1, "native2"); expect(await typed(f.read({ cursor: valid, endCursor: otherCutoff }))).toMatchObject({ code: "billing_cursor_invalid" });
  });
  it.each([0, 51, 2.5, Number.MAX_SAFE_INTEGER + 1])( "rejects invalid limit %i", async limit => { const f = setup(); expect(await typed(f.read({ limit }))).toMatchObject({ code: "billing_cursor_invalid" }); });
  it("native invalid/read-limit failures become unverified rather than zero/complete/cursor-proven", async () => {
    const f = setup(); const cursor = encodeBillingCursor({ status: "open", limit: 25 }, now, "not-native-json"); expect(await typed(f.read({ cursor }))).toEqual({ kind: "billing_read_error", version: 1, code: "billing_read_unverified" });
  });
  it("fresh persisted viewer works, denial occurs before native calls and protected fields remain withheld", async () => {
    const f = setup(); f.seed("open", now - 1, { providerSessionId: "pi_a", providerPaymentIntentId: "pi_private1234", evidence: { providerRefundId: "re_x", SECRET_PAYLOAD: "private" } });
    const data = await f.read({}, "viewer"); expect(data.role).toBe("viewer"); expect(data.page[0].idsMasked).toMatchObject({ session: "pi_…", paymentIntent: "pi_…1234", providerRefund: "re_…" }); expect(JSON.stringify(data)).not.toContain("SECRET");
    const before = f.calls.length; expect(await typed(f.read({}, "removed"))).toMatchObject({ code: "billing_access_denied" }); expect(f.calls).toHaveLength(before);
  });
  it("legacy query still uses its bounded legacy shape, unaffected by new native endpoint", async () => {
    const f = setup(); for (let i = 0; i < 30; i++) f.seed();
    const data = await f.h.call<{ status: string; capped: boolean; exceptions: unknown[] }>(operationsExceptions.listOperationsExceptions, {}, "admin");
    expect(data).toHaveProperty("exceptions"); expect(data).not.toHaveProperty("page"); expect(data.exceptions).toHaveLength(25); expect(data.capped).toBe(true); expect(f.calls).toEqual([]);
  });
});
