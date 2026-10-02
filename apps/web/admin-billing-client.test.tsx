// @vitest-environment happy-dom
// Synthetic staff/HTTP responses prove UI freshness/privacy behavior, not real
// Clerk authorization, native Convex pagination or provider-account evidence.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingDetail, BillingException, BillingExceptionPage, BillingRecovery } from "@skyla/payments";

const session = vi.hoisted(() => ({ status: "signed-in", email: "synthetic@staff.invalid", staffFetch: vi.fn(), signOut: vi.fn() }));
vi.mock("@/components/staff-auth-provider", () => ({ useStaffSession: () => ({ ...session }) }));
import { AdminBillingClient, BillingDetailView } from "./components/admin-billing-client";

function exception(id = "synthetic-A", extra: Partial<BillingException> = {}): BillingException {
  return { exceptionId: id, category: "billing", status: "open", code: "paid_booking_duplicate", refs: { orderRef: "SKY1002-ABC123", saleRef: null, bookingRef: "SKY1003-DEF456" },
    idsMasked: { session: "cs_…1234", paymentIntent: "pi_…1234", providerEvent: "evt_…1234", providerRefund: null },
    moneyReceived: true, amountCents: 1000, currency: "usd", amountMeaning: "recorded_exception_amount", occurrenceCount: 2,
    firstSeenAt: 30, lastSeenAt: 50, resolvedAt: null, resolutionCode: null, resolutionRecorded: false, recordedAt: 50.5, dataIssues: [], ...extra };
}
function detail(row = exception()): BillingDetail {
  return { version: 1, role: "admin", lookup: { exceptionId: row.exceptionId }, retrievedAt: 1000, exception: row,
    evidence: { source: "webhook", eventType: "checkout.session.completed", providerState: "paid", mode: "test", moneyRecorded: true, paidAt: 40,
      attemptStatus: null, providerRequestCount: null, reconcileCount: null, sendVersion: null, attemptCount: null, autoRetryCount: null,
      providerTrackingCount: null, providerDeliveryStatus: null, refundStatus: null, providerEventCreatedAt: 40, safeReasonCode: null },
    relation: { state: "correlated", reasons: [] },
    owner: { kind: "order", ref: row.refs.orderRef, status: "paid", channel: "online", subtotalCents: 3000, feeCents: 0, totalCents: 3000, currency: "usd", visitDate: "2026-10-03", entryTime: "14:00", createdAt: 10, updatedAt: 40, dataIssues: [] },
    lines: { coverage: "complete", rows: [
      { rowId: "adult-line", kind: "ticket", admissionCategory: "adult", quantity: 1, unitAmountCents: 2000, lineTotalCents: 2000, dataIssues: [] },
      { rowId: "youth-line", kind: "ticket", admissionCategory: "youth", quantity: 1, unitAmountCents: 1000, lineTotalCents: 1000, dataIssues: [] },
      { rowId: "child-line", kind: "ticket", admissionCategory: "child", quantity: 1, unitAmountCents: 0, lineTotalCents: 0, dataIssues: [] }] },
    money: { paidFactRecorded: true, proof: "proven", reasons: [], provenPaidCents: 3000, currency: "usd" },
    refunds: { proof: "proven", reasons: [], succeededRefundCents: 0, disposition: "none_succeeded_recorded" },
    booking: { bookingRef: "SKY1003-DEF456", refs: row.refs, status: "cancelled", visitDate: "2026-10-03", entryTime: "14:00", partySize: 3, cancelledAt: 90, paidProof: "blocked", reasons: ["booking_billing_blocked"] },
    attendance: { used: true, admitted: 3, departed: 3, inside: 0, proof: "proven", reasons: [] },
    delivery: { issuance: "issued", status: "sent", acceptance: "recorded", deliveryEvidence: "recorded", sentAt: 60, deliveredAt: 70,
      providerDeliveryStatus: "bounced", providerStatusAt: 80, sendVersion: 1, attemptCount: 1, safeFailureReasonCode: null }, recovery: [],
    recent: { payments: { coverage: "complete", limit: 10, order: "native_creation_desc", rows: [] }, refunds: { coverage: "complete", limit: 10, order: "recorded_updatedAt_desc", rows: [] },
      audit: { coverage: "complete", limit: 25, order: "native_creation_desc", scope: "owner", rows: [] } },
    coverage: { owner: "complete", lines: "complete", paid: "complete", intentOwnership: "complete", refunds: "complete", booking: "complete", admission: "complete", delivery: "complete", attempt: "not_applicable", webhook: "complete" } };
}
function recovery(extra: Partial<BillingRecovery> = {}): BillingRecovery {
  return { kind: "checkout", state: "exception", correlation: "correlated", reasons: [], mode: "test", apiVersion: "2026-02-25.clover", providerState: "unknown",
    safeStopReasonCode: "checkout_reconciliation_exhausted_unknown", lastErrorRecorded: true, safeLastErrorCode: null,
    providerRequestCount: 1, reconcileCount: 8, readerProcessCount: null, autoRetryCount: null, trackingCount: null,
    firstProviderRequestAt: 10, lastProviderRequestAt: 20, lastReconciliationAttemptAt: 90, lastReaderProcessAt: null,
    lastEmailAttemptAt: null, settledAt: null, nextDueAt: null, leaseExpiresAt: null, readerLeaseExpiresAt: null, schedule: "stopped", ...extra };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let queueRows: BillingException[];
let requests: Array<{ url: string; init?: RequestInit }>;
let serverRole: "admin" | "viewer";
let detailValue: unknown;
let queueHandler: ((params: URLSearchParams) => unknown) | null;
function page(params: URLSearchParams, extra: Partial<BillingExceptionPage> = {}): BillingExceptionPage {
  return { version: 1, role: serverRole, query: { status: params.get("status") as "open" | "resolved", limit: Number(params.get("limit")) }, retrievedAt: 1000, cutoff: 100,
    startCursor: params.get("cursor"), endCursor: params.get("endCursor"), page: queueRows, continueCursor: null, splitCursor: null,
    pageStatus: null, isDone: true, segmentDone: true, capped: false, ...extra };
}
beforeEach(() => {
  session.status = "signed-in"; session.email = "synthetic@staff.invalid"; serverRole = "admin";
  requests = []; queueRows = [exception()]; detailValue = detail(); queueHandler = null;
  session.signOut.mockReset().mockResolvedValue(undefined);
  session.staffFetch.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    requests.push({ url, init }); const params = new URL(url, "https://skydeckla.com").searchParams;
    if (url.startsWith("/api/admin/exceptions?")) return json(queueHandler ? queueHandler(params) : page(params));
    if (url.startsWith("/api/admin/billing/detail?")) return json(detailValue);
    throw new Error(`Unexpected synthetic read: ${url}`);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function mount() { const view = render(<AdminBillingClient />); await screen.findByRole("button", { name: /paid booking duplicate/ }); return view; }
const choose = () => fireEvent.click(screen.getByRole("button", { name: /paid booking duplicate/ }));
const detailHeading = () => screen.queryByRole("heading", { name: "paid booking duplicate" });

describe("billing fact presentation", () => {
  it("keeps an out-of-Date-range recorded timestamp from blanking the detail or exposing its raw value", () => {
    const original = detail();
    render(<BillingDetailView detail={{ ...original, retrievedAt: Number.MAX_SAFE_INTEGER }} />);
    expect(screen.getByText(/^Read Date not verified, Los Angeles time/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Money and refunds" })).toBeTruthy();
    expect(document.body.textContent).not.toContain(String(Number.MAX_SAFE_INTEGER));
    expect(within(screen.getByText("Email provider acceptance").parentElement!).getByText("Recorded Dec 31, 1969, 4:00 PM")).toBeTruthy();
  });
  it("shows recorded cancellation, blocked proof and proven no-reentry before money details", () => {
    render(<BillingDetailView detail={detail()} />);
    const restriction = screen.getByText("Booking cancellation is recorded. Admission payment proof is blocked.");
    const used = screen.getByText("Admission use recorded. No re-entry, including after refund or departure.");
    const readTime = screen.getByText(/^Read .*Los Angeles time/);
    const money = screen.getByRole("heading", { name: "Money and refunds" });
    for (const fact of [restriction, used]) {
      expect(readTime.compareDocumentPosition(fact) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(fact.compareDocumentPosition(money) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(within(screen.getByText("Proven paid amount").parentElement!).getByText("$30.00")).toBeTruthy();
  });
  it("shows unverified admission proof and possible historical use early without asserting exact-owner entry", () => {
    const original = detail();
    render(<BillingDetailView detail={{ ...original,
      booking: { ...original.booking!, status: "confirmed", cancelledAt: null, paidProof: "unverified", reasons: ["booking_payment_evidence_unverified"] },
      attendance: { used: true, admitted: null, departed: null, inside: null, proof: "unverified", reasons: ["admission_duplicate"] }
    }} />);
    const restriction = screen.getByText("Admission payment proof is unverified.");
    const possibleUse = screen.getByText("Use evidence found; its relation or counts are unverified. Do not assume unused.");
    const money = screen.getByRole("heading", { name: "Money and refunds" });
    expect(restriction.compareDocumentPosition(money) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(possibleUse.compareDocumentPosition(money) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/Admission use recorded\. No re-entry/)).toBeNull();
    expect(screen.queryByText(/Booking cancellation is recorded/)).toBeNull();
  });
  it("keeps cancellation visible when separate admission-payment proof is proven", () => {
    const original = detail();
    render(<BillingDetailView detail={{ ...original, booking: { ...original.booking!, paidProof: "proven", reasons: [] } }} />);
    const cancellation = screen.getByText("Booking cancellation is recorded.");
    expect(cancellation.compareDocumentPosition(screen.getByRole("heading", { name: "Money and refunds" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/Admission payment proof is blocked|Admission payment proof is unverified/)).toBeNull();
    expect(within(screen.getByText("Proven paid amount").parentElement!).getByText("$30.00")).toBeTruthy();
  });
  it("keeps exception amount, purchase total, historical paid fact and succeeded refunds distinct", () => {
    render(<BillingDetailView detail={detail()} />);
    const exceptionAmount = screen.getByText("Recorded exception amount").parentElement!;
    expect(within(exceptionAmount).getByText("$10.00")).toBeTruthy();
    expect(within(screen.getByText("Stored purchase total").parentElement!).getByText("$30.00")).toBeTruthy();
    expect(within(screen.getByText("Proven paid amount").parentElement!).getByText("$30.00")).toBeTruthy();
    expect(screen.getByText(/Paid fact recorded independently/)).toBeTruthy();
    expect(screen.getByText(/No succeeded refund in this proven local subset/)).toBeTruthy();
    expect(screen.getByText("Adult admission")).toBeTruthy(); expect(screen.getByText("Youth admission")).toBeTruthy(); expect(screen.getByText("Child admission")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("preserves immutable used attendance and money despite cancelled booking, departure and later bounce", () => {
    render(<BillingDetailView detail={detail()} />);
    expect(screen.getByText(/Admission use recorded. No re-entry/)).toBeTruthy();
    expect(screen.getByText(/This desk grants no entry permission or current inbox proof/)).toBeTruthy();
    expect(within(screen.getByText("Positive delivery tracking").parentElement!).getByText(/Recorded/)).toBeTruthy(); expect(screen.getByText(/bounced/)).toBeTruthy();
    expect(within(screen.getByText("Email provider acceptance").parentElement!).getByText(/Recorded/)).toBeTruthy(); expect(screen.queryByText(/ready for admission/i)).toBeNull();
  });
  it("unverified/conflicting amounts and use stay explicit instead of becoming zero or unused", () => {
    const original = detail(); render(<BillingDetailView detail={{ ...original, owner: null, relation: { state: "ambiguous", reasons: ["owner_ambiguous"] },
      money: { paidFactRecorded: true, proof: "conflict", reasons: ["paid_identity_duplicate"], provenPaidCents: null, currency: null },
      refunds: { proof: "unverified", reasons: ["refund_proof_unverified"], succeededRefundCents: null, disposition: "unknown" },
      attendance: { used: null, admitted: null, departed: null, inside: null, proof: "unverified", reasons: ["admission_relation_unverified"] } }} />);
    expect(screen.getByText(/Paid fact recorded independently/)).toBeTruthy(); expect(screen.getByText(/Admission use not verified/)).toBeTruthy();
    expect(within(screen.getByText("Proven paid amount").parentElement!).getByText("Not verified")).toBeTruthy();
    expect(screen.getByText(/Returned-money amount not verified/)).toBeTruthy();
  });
  it("positive possible-use history is retained without asserting exact-owner admission", () => {
    const original = detail(); render(<BillingDetailView detail={{ ...original,
      attendance: { used: true, admitted: null, departed: null, inside: null, proof: "unverified", reasons: ["admission_duplicate"] } }} />);
    expect(screen.getByText(/Use evidence found; its relation or counts are unverified. Do not assume unused/)).toBeTruthy();
    expect(screen.queryByText(/Admission use recorded. No re-entry/)).toBeNull();
  });
  it("nullable booking reference is visibly unverified rather than literal null", () => {
    const original = detail(); render(<BillingDetailView detail={{ ...original, booking: { ...original.booking!, bookingRef: null } }} />);
    expect(screen.getByText(/Reference not verified/)).toBeTruthy(); expect(document.body.textContent).not.toContain("null ·");
  });
  it("stopped, scheduled and active claims never imply healthy automation or a verified provider read", () => {
    const original = detail(); render(<BillingDetailView detail={{ ...original, recovery: [recovery()] }} />);
    expect(screen.getByText(/No safe retry is scheduled/)).toBeTruthy(); expect(screen.getByText(/Scheduling and attempt records do not verify provider reads/)).toBeTruthy();
    expect(screen.getByText(/unsafe text withheld/)).toBeTruthy();
  });
  it("email recovery shows relevant retry/time facts without reader/API noise", () => {
    const original = detail(); render(<BillingDetailView detail={{ ...original, recovery: [recovery({ kind: "email_send", state: "failed", providerState: "failed", mode: null,
      apiVersion: null, safeStopReasonCode: "email_delivery_outcome_unknown", providerRequestCount: null, reconcileCount: null, autoRetryCount: 4, lastEmailAttemptAt: 80 })] }} />);
    expect(screen.getByText("Automatic retry attempts")).toBeTruthy(); expect(screen.getByText("Last email attempt")).toBeTruthy();
    expect(screen.queryByText("Recorded mode / API version")).toBeNull(); expect(screen.queryByText("Reader process attempts")).toBeNull(); expect(screen.queryByText("Last reconciliation attempt")).toBeNull();
  });
  it("verified cafe-only sale has recorded money without requiring a ticket or admission", () => {
    const original = detail(); const refs = { orderRef: null, saleRef: "SALE261002-ABC123", bookingRef: null };
    render(<BillingDetailView detail={{ ...original, exception: { ...original.exception, refs }, owner: { ...original.owner!, kind: "sale", ref: refs.saleRef, channel: "pos", subtotalCents: 1000, totalCents: 1000 },
      money: { ...original.money, provenPaidCents: 1000 }, booking: null, lines: { coverage: "complete", rows: [{ rowId: "cafe-line", kind: "cafe", admissionCategory: null, quantity: 2, unitAmountCents: 500, lineTotalCents: 1000, dataIssues: [] }] },
      attendance: { used: null, admitted: null, departed: null, inside: null, proof: "not_applicable", reasons: [] },
      delivery: { ...original.delivery, issuance: "not_applicable", status: null, acceptance: "none_recorded", deliveryEvidence: "none_recorded", sentAt: null, deliveredAt: null, providerDeliveryStatus: null, providerStatusAt: null } }} />);
    expect(screen.getByText("cafe")).toBeTruthy(); expect(screen.getByText("Not applicable to this verified purchase")).toBeTruthy();
    expect(within(screen.getByText("Proven paid amount").parentElement!).getByText("$10.00")).toBeTruthy(); expect(screen.queryByText("Adult admission")).toBeNull();
    expect(screen.queryByText(/Admission payment proof is|Booking cancellation is recorded|No re-entry|Do not assume unused/)).toBeNull();
  });
  it("capped recent history stays a prefix and does not alter independently proven paid amount", () => {
    const original = detail(); const rows = Array.from({ length: 10 }, (_, index) => ({ rowId: `payment-${index}`, refs: original.exception.refs, provider: "stripe" as const,
      paymentIdMasked: `cs_…${String(index).padStart(4, "0")}`, intentIdMasked: "pi_…1234", eventIdMasked: "evt_…1234", status: "failed" as const,
      amountCents: 1000, currency: "usd" as const, recordedAt: 100 - index, createdAt: 100 - index, dataIssues: [] }));
    render(<BillingDetailView detail={{ ...original, recent: { ...original.recent, payments: { ...original.recent.payments, coverage: "capped", rows } } }} />);
    expect(screen.getByText(/Only the recent recorded prefix is shown/)).toBeTruthy(); expect(within(screen.getByText("Proven paid amount").parentElement!).getByText("$30.00")).toBeTruthy();
    expect(screen.queryByText(/net revenue/i)).toBeNull();
  });
});

describe("read-only billing controller freshness and privacy", () => {
  it("loads explicit paginated query, fresh exact selection and meaningful detail focus without mutations or storage", async () => {
    const set = vi.spyOn(window.localStorage, "setItem"); const view = await mount(); choose();
    await screen.findByRole("heading", { name: "paid booking duplicate" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Selected billing evidence"); expect(document.activeElement?.contains(detailHeading())).toBe(true);
    expect(requests[0]?.url).toContain("page=1&status=open&limit=25"); expect(requests[1]?.url).toContain("exceptionId=synthetic-A");
    expect(requests.every(request => !request.init?.method || request.init.method === "GET")).toBe(true); expect(set).not.toHaveBeenCalled();
    view.unmount(); set.mockRestore();
  });
  it("admin and viewer only read; supported viewer gets no financial controls", async () => {
    serverRole = "viewer"; detailValue = { ...detail(), role: "viewer" }; await mount(); choose(); await screen.findByRole("heading", { name: "paid booking duplicate" });
    expect(screen.getByText(/Read only/)).toBeTruthy();
    for (const name of [/refund/i, /resolve/i, /resend/i, /mark paid/i, /admit/i]) expect(screen.queryByRole("button", { name })).toBeNull();
  });
  it.each(["signed-out", "unconfigured", "loading", "signing-out"])("does not read protected facts while %s", status => {
    session.status = status; render(<AdminBillingClient />); expect(requests).toEqual([]); expect(detailHeading()).toBeNull(); expect(screen.queryByRole("button", { name: "Reload records" })).toBeNull();
  });
  it("rapid A-to-B selection clears A immediately and late A cannot replace B", async () => {
    const second = exception("synthetic-B", { code: "order_not_found", recordedAt: 49 }); queueRows.push(second); await mount();
    let releaseA!: (value: Response) => void; let releaseB!: (value: Response) => void;
    session.staffFetch.mockImplementation((url: string) => new Promise<Response>(resolve => { if (url.includes("synthetic-A")) releaseA = resolve; else releaseB = resolve; }));
    choose(); expect(detailHeading()).toBeNull(); fireEvent.click(screen.getByRole("button", { name: /order not found/ }));
    await act(async () => { releaseB(json(detail(second))); }); await screen.findByRole("heading", { name: "order not found" });
    await act(async () => { releaseA(json(detail())); }); expect(detailHeading()).toBeNull(); expect(screen.getByRole("heading", { name: "order not found" })).toBeTruthy();
  });
  it("status filter change immediately clears prior detail and drops late filter replies", async () => {
    await mount(); choose(); await screen.findByRole("heading", { name: "paid booking duplicate" });
    let releaseResolved!: (value: Response) => void; const original = session.staffFetch.getMockImplementation()!;
    session.staffFetch.mockImplementation((url: string) => url.includes("status=resolved") ? new Promise<Response>(resolve => { releaseResolved = resolve; }) : original(url));
    fireEvent.change(screen.getByLabelText("Recorded exception status"), { target: { value: "resolved" } }); expect(detailHeading()).toBeNull(); expect(screen.queryByRole("button", { name: /paid booking duplicate/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Recorded exception status"), { target: { value: "open" } }); await screen.findByRole("button", { name: /paid booking duplicate/ });
    const params = new URLSearchParams({ status: "resolved", limit: "25" }); await act(async () => { releaseResolved(json(page(params, { page: [exception("resolved", { status: "resolved", resolvedAt: 80, resolutionRecorded: true })] }))); });
    expect(screen.getByRole("button", { name: /paid booking duplicate/ }).textContent).toContain("open");
  });
  it("Reload clears selected detail immediately and ignores its late response", async () => {
    await mount(); let release!: (response: Response) => void; const original = session.staffFetch.getMockImplementation()!;
    session.staffFetch.mockImplementation((url: string) => url.includes("billing/detail") ? new Promise<Response>(resolve => { release = resolve; }) : original(url));
    choose(); fireEvent.click(screen.getByRole("button", { name: "Reload records" })); await screen.findByRole("button", { name: /paid booking duplicate/ });
    await act(async () => { release(json(detail())); }); expect(detailHeading()).toBeNull();
  });
  it.each([[403, "billing_access_denied"], [404, "billing_record_not_found"], [502, "billing_read_unverified"], [400, "billing_cursor_invalid"]] as const)("current detail%d clears queue, role and selected protected facts without echoing error text", async (status, code) => {
    await mount(); choose(); await screen.findByRole("heading", { name: "paid booking duplicate" });
    session.staffFetch.mockResolvedValue(json({ error: "SECRET bearer https://private.invalid customer@private.invalid", code }, status));
    choose(); await screen.findByRole("alert"); expect(detailHeading()).toBeNull(); expect(screen.queryByRole("button", { name: /paid booking duplicate/ })).toBeNull();
    expect(document.body.textContent).not.toContain("SECRET"); expect(document.body.textContent).not.toContain("private.invalid");
  });
  it.each(["malformed", "foreign", "unknown-role", "raw-id", "extra-secret"])("a%s success-shaped detail clears previous facts", async kind => {
    await mount(); choose(); await screen.findByRole("heading", { name: "paid booking duplicate" });
    const valid = detail(); detailValue = kind === "malformed" ? { version: 1 } : kind === "foreign" ? { ...valid, lookup: { exceptionId: "foreign" } }
      : kind === "unknown-role" ? { ...valid, role: "pos" } : kind === "raw-id" ? { ...valid, exception: { ...valid.exception, idsMasked: { ...valid.exception.idsMasked, paymentIntent: "pi_SECRET" } } }
      : { ...valid, secret: "SECRET customer@private.invalid" };
    choose(); await screen.findByRole("alert"); expect(detailHeading()).toBeNull(); expect(screen.queryByRole("button", { name: /paid booking duplicate/ })).toBeNull(); expect(document.body.textContent).not.toContain("SECRET");
  });
  it("old staff detail cannot repopulate a new viewer session", async () => {
    const view = await mount(); let release!: (response: Response) => void; const original = session.staffFetch.getMockImplementation()!;
    session.staffFetch.mockImplementation((url: string) => url.includes("billing/detail") ? new Promise<Response>(resolve => { release = resolve; }) : original(url)); choose();
    session.email = "new-viewer@staff.invalid"; serverRole = "viewer"; view.rerender(<AdminBillingClient />);
    await screen.findByText(/Read only/); await act(async () => { release(json(detail())); }); expect(detailHeading()).toBeNull();
  });
  it("a replaced staffFetch function immediately hides old role/queue/detail and drops old read", async () => {
    const view = await mount(); choose(); await screen.findByRole("heading", { name: "paid booking duplicate" });
    const replacement = vi.fn(async (url: string) => json(page(new URL(url, "https://skydeckla.com").searchParams)));
    session.staffFetch = replacement; view.rerender(<AdminBillingClient />);
    expect(detailHeading()).toBeNull(); expect(screen.queryByRole("button", { name: /paid booking duplicate/ })).toBeNull();
    expect(screen.queryByText("Fresh recorded evidence loaded. No live provider check was made.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reload records" })); await screen.findByRole("button", { name: /paid booking duplicate/ }); expect(replacement).toHaveBeenCalledTimes(1);
  });
  it("sign out clears facts synchronously even if provider sign-out fails", async () => {
    await mount(); choose(); await screen.findByRole("heading", { name: "paid booking duplicate" }); session.signOut.mockRejectedValue(new Error("SECRET"));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" })); expect(detailHeading()).toBeNull(); expect(screen.queryByRole("button", { name: /paid booking duplicate/ })).toBeNull();
    await screen.findByText(/Staff sign-out could not be confirmed/); expect(document.body.textContent).not.toContain("SECRET");
  });
  it("split reads are discarded, empty advancing pages consume a bounded batch and Load more resumes", async () => {
    let reads = 0; const seen: Array<[string | null, string | null]> = [];
    queueHandler = params => {
      reads += 1; seen.push([params.get("cursor"), params.get("endCursor")]);
      if (reads === 1) return page(params, { pageStatus: "SplitRequired", continueCursor: "E", splitCursor: "M", isDone: false, segmentDone: false, capped: true, page: [exception("discarded", { code: "order_not_found" })] });
      if (params.has("endCursor")) return page(params, { page: [], isDone: false, capped: true });
      if (reads < 10) return page(params, { page: [], continueCursor: `tail-${reads}`, isDone: false, segmentDone: false, capped: true });
      return page(params);
    };
    render(<AdminBillingClient />); await screen.findByText("More recorded pages remain to be loaded."); expect(reads).toBe(8); expect(screen.queryByRole("button", { name: /order not found/ })).toBeNull();
    expect(seen.slice(0, 4)).toEqual([[null, null], [null, "M"], ["M", "E"], ["E", null]]);
    fireEvent.click(screen.getByRole("button", { name: "Load more" })); await screen.findByRole("button", { name: /paid booking duplicate/ }); expect(reads).toBe(10);
  });
  it("duplicate accepted rows or foreign query/cutoff prevent false completion and clear queue", async () => {
    queueHandler = params => params.has("cursor") ? page(params) : page(params, { continueCursor: "next", isDone: false, segmentDone: false, capped: true });
    render(<AdminBillingClient />); await screen.findByRole("alert"); expect(screen.queryByRole("button", { name: /paid booking duplicate/ })).toBeNull();
    expect(screen.queryByText("These pages have finished loading. Reload records for current facts.")).toBeNull();
  });
});
