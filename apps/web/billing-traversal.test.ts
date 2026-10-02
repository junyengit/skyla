import { describe, expect, it, vi } from "vitest";
import type { BillingException, BillingExceptionPage, BillingPageRequest } from "@skyla/payments";
import { acceptBillingPage, billingSegmentLimit, readBillingBatch, startBillingTraversal } from "./lib/billing-traversal";

function row(id: string, recordedAt = 50.5): BillingException {
  return { exceptionId: id, category: "billing", status: "open", code: "paid_booking_duplicate",
    refs: { orderRef: "SKY1002-ABC123", saleRef: null, bookingRef: null },
    idsMasked: { session: null, paymentIntent: null, providerEvent: null, providerRefund: null },
    moneyReceived: true, amountCents: 3000, currency: "usd", amountMeaning: "recorded_exception_amount",
    occurrenceCount: 1, firstSeenAt: 30, lastSeenAt: 50, resolvedAt: null, resolutionCode: null,
    resolutionRecorded: false, recordedAt, dataIssues: [] };
}
function page(extra: Partial<BillingExceptionPage> = {}): BillingExceptionPage {
  return { version: 1, role: "admin", query: { status: "open", limit: 25 }, retrievedAt: 101, cutoff: 100,
    startCursor: null, endCursor: null, page: [], continueCursor: null, splitCursor: null,
    pageStatus: null, isDone: true, segmentDone: true, capped: false, ...extra };
}

describe("billing native read traversal", () => {
  it.each(["SplitRecommended", "SplitRequired"] as const)("discards %s rows and verifies both halves plus outer tail", kind => {
    let state = acceptBillingPage(startBillingTraversal("open"), page({ pageStatus: kind, splitCursor: "M", continueCursor: "E", isDone: false, segmentDone: false, capped: true, page: [row("discarded")] }));
    expect(state.rows).toEqual([]); expect(state.segments).toEqual([{ cursor: null, endCursor: "M" }, { cursor: "M", endCursor: "E" }, { cursor: "E", endCursor: null }]);
    state = acceptBillingPage(state, page({ endCursor: "M", isDone: false, capped: true, page: [row("first")] }));
    state = acceptBillingPage(state, page({ startCursor: "M", endCursor: "E", isDone: false, capped: true, page: [row("second")] }));
    expect(state.segments).toEqual([{ cursor: "E", endCursor: null }]);
    state = acceptBillingPage(state, page({ startCursor: "E" })); expect(state.segments).toEqual([]); expect(state.rows.map(item => item.exceptionId)).toEqual(["first", "second"]);
  });
  it("recovers nested bounded splits without dropping the original remainder", () => {
    let state = acceptBillingPage(startBillingTraversal("open"), page({ pageStatus: "SplitRequired", splitCursor: "M", continueCursor: "E", isDone: false, segmentDone: false, capped: true }));
    state = acceptBillingPage(state, page({ endCursor: "M", pageStatus: "SplitRecommended", splitCursor: "K", continueCursor: "L", isDone: false, segmentDone: false, capped: true }));
    expect(state.segments).toEqual([{ cursor: null, endCursor: "K" }, { cursor: "K", endCursor: "L" }, { cursor: "L", endCursor: "M" }, { cursor: "M", endCursor: "E" }, { cursor: "E", endCursor: null }]);
  });
  it("advances empty sparse pages; fewer than requested rows never proves completion", () => {
    let state = acceptBillingPage(startBillingTraversal("open"), page({ page: [], continueCursor: "next", isDone: false, segmentDone: false, capped: true }));
    expect(state.rows).toEqual([]); expect(state.segments).toHaveLength(1);
    state = acceptBillingPage(state, page({ startCursor: "next", page: [row("one")], continueCursor: "tail", isDone: false, segmentDone: false, capped: true }));
    expect(state.rows).toHaveLength(1); expect(state.segments).toEqual([{ cursor: "tail", endCursor: null }]);
  });
  it("retains more than120 rows with fractional creation-time ties and descending order", async () => {
    let index = 0;
    const result = await readBillingBatch(startBillingTraversal("open"), async request => {
      const next = index++;
      return page({ startCursor: request.cursor, page: Array.from({ length: 25 }, (_, offset) => row(`${next}-${offset}`, 90.5 - next)),
        continueCursor: next === 4 ? null : `next-${next}`, isDone: next === 4, segmentDone: next === 4, capped: next !== 4 });
    }, () => true);
    expect(result?.rows).toHaveLength(125); expect(result?.segments).toEqual([]); expect(index).toBe(5);
  });
  it("runs at most8 reads per click and preserves continuation for the next action", async () => {
    let reads = 0;
    const read = vi.fn(async (request: BillingPageRequest) => {
      reads += 1; return page({ startCursor: request.cursor, continueCursor: reads < 11 ? `next-${reads}` : null, isDone: reads === 11, segmentDone: reads === 11, capped: reads !== 11 });
    });
    const first = await readBillingBatch(startBillingTraversal("open"), read, () => true);
    expect(read).toHaveBeenCalledTimes(8); expect(first?.segments).toHaveLength(1);
    const second = await readBillingBatch(first!, read, () => true); expect(read).toHaveBeenCalledTimes(11); expect(second?.segments).toEqual([]);
  });
  it("drops stale asynchronous reads before rows or a continuation can publish", async () => {
    let current = true; let release!: (result: BillingExceptionPage) => void;
    const read = vi.fn(() => new Promise<BillingExceptionPage>(resolve => { release = resolve; }));
    const result = readBillingBatch(startBillingTraversal("open"), read, () => current);
    current = false; release(page({ page: [row("stale")] })); expect(await result).toBeNull(); expect(read).toHaveBeenCalledTimes(1);
  });
  it("rejects duplicate IDs within/across accepted pages without deduping by masked identity", () => {
    expect(() => acceptBillingPage(startBillingTraversal("open"), page({ page: [row("same"), row("same")] }))).toThrow();
    const state = acceptBillingPage(startBillingTraversal("open"), page({ page: [row("same")], continueCursor: "next", isDone: false, segmentDone: false, capped: true }));
    expect(() => acceptBillingPage(state, page({ startCursor: "next", page: [row("same")] }))).toThrow();
    expect(acceptBillingPage(state, page({ startCursor: "next", page: [row("different")] })).rows).toHaveLength(2);
  });
  it("rejects reversed creation order, after-cutoff membership and request/role drift", () => {
    const state = acceptBillingPage(startBillingTraversal("open"), page({ page: [row("first", 50.5)], continueCursor: "next", isDone: false, segmentDone: false, capped: true }));
    for (const wrong of [page({ startCursor: "next", page: [row("newer", 50.6)] }), page({ startCursor: "next", page: [row("after-cutoff", 101)] }),
      page({ startCursor: "next", cutoff: 99 }), page({ startCursor: "next", role: "viewer" }), page({ startCursor: "next", query: { status: "resolved", limit: 25 } }),
      page({ startCursor: "next", query: { status: "open", limit: 50 } }), page({ startCursor: "foreign" }), page({ startCursor: "next", endCursor: "foreign" })]) expect(() => acceptBillingPage(state, wrong)).toThrow();
  });
  it("rejects cursor cycles, non-progress and false unbounded completion", () => {
    const first = acceptBillingPage(startBillingTraversal("open"), page({ continueCursor: "A", isDone: false, segmentDone: false, capped: true }));
    const second = acceptBillingPage(first, page({ startCursor: "A", continueCursor: "B", isDone: false, segmentDone: false, capped: true }));
    expect(() => acceptBillingPage(second, page({ startCursor: "B", continueCursor: "A", isDone: false, segmentDone: false, capped: true }))).toThrow();
    expect(() => acceptBillingPage(first, page({ startCursor: "A", continueCursor: "A", isDone: false, segmentDone: false, capped: true }))).toThrow();
    expect(() => acceptBillingPage(first, page({ startCursor: "A", isDone: false, segmentDone: true, capped: true }))).toThrow();
  });
  it("permits a legal equal start/end empty segment but requires the unbounded tail", () => {
    const state = { ...startBillingTraversal("open"), segments: [{ cursor: "E", endCursor: "E" }, { cursor: "E", endCursor: null }] };
    const partial = acceptBillingPage(state, page({ startCursor: "E", endCursor: "E", isDone: false, capped: true }));
    expect(partial.segments).toEqual([{ cursor: "E", endCursor: null }]);
    expect(acceptBillingPage(partial, page({ startCursor: "E" })).segments).toEqual([]);
  });
  it("enforces the4096 total-work ceiling without silently finishing partial reads", () => {
    const visited = Array.from({ length: billingSegmentLimit - 1 }, (_, index) => JSON.stringify({ cursor: `past-${index}`, endCursor: null }));
    const state = { ...startBillingTraversal("open"), visited, segments: [{ cursor: "current", endCursor: null }] };
    const final = acceptBillingPage(state, page({ startCursor: "current" })); expect(final.visited).toHaveLength(4096); expect(final.segments).toEqual([]);
    expect(() => acceptBillingPage(state, page({ startCursor: "current", continueCursor: "more", isDone: false, segmentDone: false, capped: true }))).toThrow();
  });
});
