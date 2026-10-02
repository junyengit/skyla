import { describe, expect, it } from "vitest";
import { billingDetailFixture, billingPageFixture, billingPaidDetailFixture } from "./billing-contract-test-support";
import { BillingRequestError, BillingResponseError, normalizeBillingDetailRequest, normalizeBillingPageRequest, parseBillingBackendReadError, parseBillingDetail, parseBillingExceptionPage } from "./lib/billing-contract";

const expected = { status: "open" as const, limit: 25, cursor: null, endCursor: null };
describe("Billing strict request contracts", () => {
  it("normalizes only explicit bounded queue mode and exact detail selection", () => {
    expect(normalizeBillingPageRequest(new URLSearchParams("page=1"))).toEqual(expected);
    expect(normalizeBillingDetailRequest(new URLSearchParams("exceptionId=exception-one"))).toEqual({ exceptionId: "exception-one" });
  });
  it.each(["", "page=2", "page=", "page=1&page=1", "page=1&role=admin", "page=1&status=all", "page=1&limit=1.5", "page=1&limit=51", "page=1&cursor=", "page=1&cursor=%20opaque", "page=1&endCursor=%00"])("rejects unsupported queue params %s", query => {
    expect(() => normalizeBillingPageRequest(new URLSearchParams(query))).toThrow(BillingRequestError);
  });
  it.each(["", "exceptionId=", "exceptionId=one&exceptionId=two", "exceptionId=one&orderRef=SKY2610-ABC123"])("rejects ambiguous detail selection %s", query => {
    expect(() => normalizeBillingDetailRequest(new URLSearchParams(query))).toThrow(BillingRequestError);
  });
});
describe("Billing native page response contract", () => {
  it("accepts equal fractional creation times, empty progressing and bounded completed segments", () => {
    const page = billingPageFixture();
    page.page = [billingDetailFixture("one").exception, billingDetailFixture("two").exception];
    page.page.forEach(row => { row.recordedAt = 100.5; });
    expect(parseBillingExceptionPage(page, expected).page).toHaveLength(2);
    page.page = []; page.continueCursor = "next"; page.isDone = false; page.segmentDone = false; page.capped = true;
    expect(parseBillingExceptionPage(page, expected).segmentDone).toBe(false);
    page.startCursor = "end"; page.endCursor = "end"; page.continueCursor = null; page.segmentDone = true;
    expect(parseBillingExceptionPage(page, { ...expected, cursor: "end", endCursor: "end" }).isDone).toBe(false);
  });
  it("accepts more rows than numItems for a completed bounded native segment without truncation", () => {
    const page = billingPageFixture();
    page.endCursor = "bounded-end"; page.isDone = false; page.capped = true;
    page.page = Array.from({ length: 60 }, (_, index) => billingDetailFixture(`exception-${index}`).exception);
    expect(parseBillingExceptionPage(page, { ...expected, endCursor: "bounded-end" }).page).toHaveLength(60);
    page.page = Array.from({ length: 101 }, (_, index) => billingDetailFixture(`exception-${index}`).exception);
    expect(() => parseBillingExceptionPage(page, { ...expected, endCursor: "bounded-end" })).toThrow(BillingResponseError);
  });
  it("requires split work to remain incomplete even when native tail was encountered", () => {
    const page = { ...billingPageFixture(), pageStatus: "SplitRequired" as const, splitCursor: "middle", continueCursor: "tail", isDone: false, segmentDone: false, capped: true };
    expect(parseBillingExceptionPage(page, expected).pageStatus).toBe("SplitRequired");
    expect(() => parseBillingExceptionPage({ ...page, isDone: true }, expected)).toThrow(BillingResponseError);
  });
  it.each([
    (p: ReturnType<typeof billingPageFixture>) => { p.query.limit = 50; },
    p => { p.role = "pos" as never; }, p => { p.endCursor = "foreign"; }, p => { p.cutoff = 1001; },
    p => { p.capped = true; }, p => { p.page = [billingDetailFixture().exception, billingDetailFixture().exception]; },
    p => { p.page = [billingDetailFixture().exception]; p.page[0]!.recordedAt = 1001; },
    p => { p.page = [billingDetailFixture("one").exception, billingDetailFixture("two").exception]; p.page[1]!.recordedAt = 101; },
    p => { p.continueCursor = "next"; }, p => { Object.assign(p, { customerEmail: "privacy-canary@example.com" }); }
  ])("rejects foreign or falsely completed page %#", mutate => {
    const page = billingPageFixture(); mutate(page);
    expect(() => parseBillingExceptionPage(page, expected)).toThrow(BillingResponseError);
  });
});
describe("Billing selected detail proof boundaries", () => {
  it("keeps an unassigned exception unknown and independently retains canceled-owner money", () => {
    expect(parseBillingDetail(billingDetailFixture(), { exceptionId: "exception-one" }).money.proof).toBe("unverified");
    const paid = parseBillingDetail(billingPaidDetailFixture(), { exceptionId: "exception-one" });
    expect(paid.owner?.status).toBe("canceled"); expect(paid.money.provenPaidCents).toBe(3000); expect(paid.refunds.succeededRefundCents).toBe(1000);
  });
  it("preserves used history with unknown counts and accepted email with a later bounce", () => {
    const row = billingPaidDetailFixture();
    row.attendance.used = true;
    row.booking = { bookingRef: "SKY2610-BOOK01", refs: { orderRef: "SKY2610-ABC123", saleRef: null, bookingRef: "SKY2610-BOOK01" }, status: "cancelled", visitDate: "2026-10-02", entryTime: "09:00", partySize: 3,
      cancelledAt: 900, paidProof: "blocked", reasons: ["booking_payment_not_confirmed"] };
    row.coverage.booking = "complete"; row.coverage.delivery = "complete";
    row.delivery = { issuance: "issued", status: "sent", acceptance: "recorded", deliveryEvidence: "recorded", sentAt: 400, deliveredAt: 500,
      providerDeliveryStatus: "bounced", providerStatusAt: 900, sendVersion: 1, attemptCount: 1, safeFailureReasonCode: "email_bounced" };
    const result = parseBillingDetail(row, { exceptionId: "exception-one" });
    expect(result.attendance.used).toBe(true); expect(result.attendance.inside).toBe(null); expect(result.delivery.deliveredAt).toBe(500);
  });
  it.each([
    (p: ReturnType<typeof billingPaidDetailFixture>) => { p.lookup.exceptionId = "foreign"; },
    p => { p.exception.refs.orderRef = "guest@example.com"; }, p => { p.exception.idsMasked.session = "pi_short"; },
    p => { p.exception.idsMasked.session = "pi_…SHORTID"; }, p => { p.money.provenPaidCents = 3000.5; },
    p => { p.money.provenPaidCents = Number.MAX_SAFE_INTEGER + 1; }, p => { p.coverage.intentOwnership = "capped"; },
    p => { p.money.proof = "unverified"; }, p => { p.refunds.succeededRefundCents = 4000; },
    p => { p.refunds.disposition = "full"; }, p => { p.owner!.feeCents = 1; },
    p => { p.attendance = { used: true, admitted: 3, departed: 2, inside: 3, proof: "proven", reasons: [] }; },
    p => { p.delivery.deliveredAt = 300; p.delivery.deliveryEvidence = "recorded"; },
    p => { Object.assign(p.evidence, { providerRefundId: "raw-privacy-canary" }); },
    p => { p.exception.code = "secret_token_CANARY" as never; },
    p => { p.attendance.used = false; p.coverage.booking = "complete"; p.coverage.admission = "complete"; },
    p => { p.recent.payments.coverage = "capped"; },
    p => { p.exception.category = "checkout_attempt"; p.evidence.providerState = "processing"; },
    p => { p.recent.audit.rows = [{ rowId: "audit-one", action: "pos.terminalPayment.paid", entityType: "order", createdAt: 500, recordedAt: 500,
      facts: { amountCents: 3000, moneyReceived: true, sendVersion: null, attemptCount: null, safeReasonCode: null }, dataIssues: [] }]; },
    p => { p.recent.payments.rows = Array.from({ length: 11 }, (_, n) => ({ rowId: String(n), refs: { orderRef: null, saleRef: null, bookingRef: null }, provider: "stripe", paymentIdMasked: "id…", intentIdMasked: null, eventIdMasked: null, status: "failed", amountCents: 3000, currency: "usd", recordedAt: 100, createdAt: 100, dataIssues: [] })); }
  ])("rejects unsupported exposure or inflated proof %#", mutate => {
    const row = billingPaidDetailFixture(); mutate(row);
    expect(() => parseBillingDetail(row, { exceptionId: "exception-one" })).toThrow(BillingResponseError);
  });
  it("does not transform a failed proof into zero money or a successful empty record", () => {
    const row = billingDetailFixture(); row.money.provenPaidCents = 0;
    expect(() => parseBillingDetail(row, { exceptionId: "exception-one" })).toThrow(BillingResponseError);
    expect(() => parseBillingDetail({}, { exceptionId: "exception-one" })).toThrow(BillingResponseError);
  });
});
describe("Billing typed read receipts", () => {
  it("binds exact404 lookup and rejects message text or extra/foreign fields", () => {
    const receipt = { kind: "billing_read_error", version: 1, code: "billing_record_not_found", lookup: { exceptionId: "one" } };
    expect(parseBillingBackendReadError(receipt, { exceptionId: "one" }).code).toBe("billing_record_not_found");
    expect(() => parseBillingBackendReadError(receipt, { exceptionId: "two" })).toThrow(BillingResponseError);
    expect(() => parseBillingBackendReadError({ ...receipt, message: "secret-token" }, { exceptionId: "one" })).toThrow(BillingResponseError);
    expect(() => parseBillingBackendReadError({ message: "Staff role must be viewer" })).toThrow(BillingResponseError);
  });
});


describe("Billing exact proof-domain correlation regressions", () => {
  function related() {
    const row = billingPaidDetailFixture();
    row.owner!.status = "paid";
    row.booking = { bookingRef: "SKY2610-BOOK01", refs: { orderRef: "SKY2610-ABC123", saleRef: null, bookingRef: "SKY2610-BOOK01" }, status: "confirmed", visitDate: "2026-10-02", entryTime: "09:00", partySize: 3,
      cancelledAt: null, paidProof: "proven", reasons: [] };
    row.coverage.booking = "complete"; row.coverage.admission = "complete";
    row.attendance = { used: false, admitted: null, departed: null, inside: null, proof: "proven", reasons: [] };
    return row;
  }
  function accepted() {
    const row = related(); row.coverage.delivery = "complete";
    row.delivery = { issuance: "issued", status: "sent", acceptance: "recorded", deliveryEvidence: "recorded", sentAt: 400, deliveredAt: 500,
      providerDeliveryStatus: "bounced", providerStatusAt: 900, sendVersion: 1, attemptCount: 1, safeFailureReasonCode: "email_bounced" };
    return row;
  }
  const parse = (row: unknown) => parseBillingDetail(row, { exceptionId: "exception-one" });
  it("rejects a correlated owner when the exception has missing or opposite-kind references", () => {
    const row = billingPaidDetailFixture(); row.exception.refs.orderRef = null;
    expect(() => parse(row)).toThrow(BillingResponseError);
    row.exception.refs.saleRef = "SALE261002-ABC123";
    expect(() => parse(row)).toThrow(BillingResponseError);
  });
  it("does not prove a booking from two matching null dates or entry times", () => {
    expect(parse(related()).booking?.paidProof).toBe("proven");
    for (const field of ["visitDate", "entryTime"] as const) {
      const row = related(); row.owner![field] = null; row.booking![field] = null;
      expect(() => parse(row)).toThrow(BillingResponseError);
    }
  });
  it("requires exact complete historical attendance without converting used history into financial eligibility", () => {
    const row = related(); row.owner!.status = "canceled"; row.owner!.entryTime = null; row.booking!.entryTime = null;
    row.refunds.succeededRefundCents = 3000; row.refunds.disposition = "full";
    row.booking!.status = "cancelled"; row.booking!.paidProof = "blocked"; row.booking!.reasons = ["booking_payment_not_confirmed"];
    row.attendance = { used: true, admitted: 3, departed: 3, inside: 0, proof: "proven", reasons: [] };
    expect(parse(row).attendance.used).toBe(true);
    expect(parse(row).money.provenPaidCents).toBe(3000);
    row.attendance.admitted = 2; row.attendance.departed = 2;
    expect(() => parse(row)).toThrow(BillingResponseError);
    row.attendance.admitted = 3; row.attendance.departed = 3; row.coverage.admission = "unverified";
    expect(() => parse(row)).toThrow(BillingResponseError);
    const unused = related(); unused.booking!.status = "checked-in";
    expect(() => parse(unused)).toThrow(BillingResponseError);
  });
  it("does not accept recorded email evidence from an unissued or unrelated delivery", () => {
    expect(parse(accepted()).delivery.deliveredAt).toBe(500);
    const historical = accepted(); historical.owner!.entryTime = null; historical.booking!.entryTime = null;
    historical.booking!.paidProof = "blocked"; historical.booking!.reasons = ["booking_entry_unverified"];
    expect(parse(historical).delivery.deliveredAt).toBe(500);
    for (const invalidate of [
      (row: ReturnType<typeof accepted>) => { row.delivery.issuance = "not_applicable"; },
      (row: ReturnType<typeof accepted>) => { row.coverage.delivery = "unverified"; },
      (row: ReturnType<typeof accepted>) => { row.booking!.refs.orderRef = "SKY2610-OTHER1"; }
    ]) { const row = accepted(); invalidate(row); expect(() => parse(row)).toThrow(BillingResponseError); }
  });
  it("requires correlated recovery to share the exact owner channel and source coverage", () => {
    const row = billingPaidDetailFixture(); row.coverage.attempt = "complete";
    row.recovery = [{ kind: "checkout", state: "open", correlation: "correlated", reasons: [], mode: "test", apiVersion: "2026-02-25.clover", providerState: "open", safeStopReasonCode: null,
      lastErrorRecorded: false, safeLastErrorCode: null, providerRequestCount: 1, reconcileCount: 1, readerProcessCount: null, autoRetryCount: null, trackingCount: null,
      firstProviderRequestAt: 100, lastProviderRequestAt: 100, lastReconciliationAttemptAt: 900, lastReaderProcessAt: null, lastEmailAttemptAt: null, settledAt: null,
      nextDueAt: null, leaseExpiresAt: null, readerLeaseExpiresAt: null, schedule: "none_recorded" }];
    expect(parse(row).recovery[0]?.correlation).toBe("correlated");
    row.recovery[0]!.kind = "terminal"; row.recovery[0]!.providerState = "requires_payment_method";
    expect(() => parse(row)).toThrow(BillingResponseError);
    row.recovery[0]!.kind = "checkout"; row.recovery[0]!.providerState = "open"; row.coverage.attempt = "unverified";
    expect(() => parse(row)).toThrow(BillingResponseError);
    row.recovery[0]!.kind = "email_tracking"; row.recovery[0]!.state = "sent"; row.recovery[0]!.providerState = "accepted";
    expect(() => parse(row)).toThrow(BillingResponseError);
  });
});

describe("Billing negative applicability proof", () => {
  function cafe() {
    const row = billingPaidDetailFixture();
    row.lines = { coverage: "complete", rows: [{ rowId: "cafe-line", kind: "cafe", admissionCategory: null, quantity: 2, unitAmountCents: 1500, lineTotalCents: 3000, dataIssues: [] }] };
    row.coverage.lines = "complete"; row.coverage.booking = "not_applicable"; row.coverage.admission = "not_applicable"; row.coverage.delivery = "not_applicable";
    row.delivery.issuance = "not_applicable"; row.delivery.acceptance = "none_recorded"; row.delivery.deliveryEvidence = "none_recorded";
    row.attendance = { used: null, admitted: null, departed: null, inside: null, proof: "not_applicable", reasons: [] };
    return row;
  }
  const parse = (row: unknown) => parseBillingDetail(row, { exceptionId: "exception-one" });
  it("allows no-admission applicability only for complete exact known cafe purchases", () => {
    const result = parse(cafe());
    expect(result.delivery.issuance).toBe("not_applicable"); expect(result.attendance.proof).toBe("not_applicable"); expect(result.money.provenPaidCents).toBe(3000);
    expect(parse(billingDetailFixture()).delivery.issuance).toBe("unverified");
    expect(parse(billingPaidDetailFixture()).delivery.issuance).toBe("unverified");
  });
  it.each([
    (row: ReturnType<typeof cafe>) => { row.lines.rows[0]!.kind = "ticket"; },
    (row: ReturnType<typeof cafe>) => { row.lines.rows[0]!.kind = null; },
    (row: ReturnType<typeof cafe>) => { row.lines.rows = []; },
    (row: ReturnType<typeof cafe>) => { row.lines.coverage = "capped"; row.coverage.lines = "capped"; },
    (row: ReturnType<typeof cafe>) => { row.lines.rows[0]!.quantity = null; },
    (row: ReturnType<typeof cafe>) => { row.lines.rows[0]!.unitAmountCents = null; },
    (row: ReturnType<typeof cafe>) => { row.lines.rows[0]!.lineTotalCents = null; },
    (row: ReturnType<typeof cafe>) => { row.lines.rows[0]!.dataIssues = ["invalid_line_total"]; },
    (row: ReturnType<typeof cafe>) => { row.lines.rows[0]!.unitAmountCents = 1000; row.lines.rows[0]!.lineTotalCents = 2000; },
    (row: ReturnType<typeof cafe>) => { row.coverage.owner = "unverified"; },
    (row: ReturnType<typeof cafe>) => { row.coverage.admission = "unverified"; }
  ])("rejects negative applicability from incomplete or contradictory purchase facts %#", mutate => {
    const row = cafe(); mutate(row); expect(() => parse(row)).toThrow(BillingResponseError);
  });
  it("rejects an unknown owner and a booking as evidence of no admission need", () => {
    const unknown = billingDetailFixture(); unknown.delivery.issuance = "not_applicable";
    expect(() => parse(unknown)).toThrow(BillingResponseError);
    const row = cafe(); row.booking = { bookingRef: "SKY2610-BOOK01", refs: { orderRef: "SKY2610-ABC123", saleRef: null, bookingRef: "SKY2610-BOOK01" }, status: "cancelled", visitDate: "2026-10-02", entryTime: null, partySize: 3,
      cancelledAt: 900, paidProof: "blocked", reasons: ["booking_payment_not_confirmed"] };
    expect(() => parse(row)).toThrow(BillingResponseError);
  });
  it("retains positive possible historical use instead of converting it into not-applicable", () => {
    const row = cafe(); row.attendance = { used: true, admitted: null, departed: null, inside: null, proof: "unverified", reasons: ["legacy_use_recorded"] };
    row.coverage.admission = "unverified";
    expect(parse(row).attendance.used).toBe(true);
    row.attendance.proof = "not_applicable";
    expect(() => parse(row)).toThrow(BillingResponseError);
  });
});
