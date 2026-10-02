import type { BillingDetail, BillingExceptionPage } from "@skyla/payments";

type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[] : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> } : T;
export function billingDetailFixture(exceptionId = "exception-one"): Mutable<BillingDetail> {
  return {
    version: 1, role: "admin", lookup: { exceptionId }, retrievedAt: 1000,
    exception: {
      exceptionId, category: "checkout_attempt", status: "open", code: "checkout_session_creation_outcome_unknown",
      refs: { orderRef: null, saleRef: null, bookingRef: null }, idsMasked: { session: "id…", paymentIntent: null, providerEvent: null, providerRefund: null },
      moneyReceived: false, amountCents: 3000, currency: "usd", amountMeaning: "recorded_exception_amount", occurrenceCount: 1,
      firstSeenAt: 100, lastSeenAt: 900, resolvedAt: null, resolutionCode: null, resolutionRecorded: false, recordedAt: 100, dataIssues: []
    },
    evidence: {
      source: null, eventType: null, providerState: null, mode: null, moneyRecorded: null, paidAt: null,
      attemptStatus: null, providerRequestCount: null, reconcileCount: null, sendVersion: null, attemptCount: null,
      autoRetryCount: null, providerTrackingCount: null, providerDeliveryStatus: null, refundStatus: null, providerEventCreatedAt: null, safeReasonCode: null
    },
    relation: { state: "missing", reasons: ["owner_missing"] }, owner: null,
    lines: { coverage: "not_applicable", rows: [] },
    money: { paidFactRecorded: false, proof: "unverified", reasons: ["owner_missing"], provenPaidCents: null, currency: null },
    refunds: { proof: "unverified", reasons: ["refund_proof_unverified"], succeededRefundCents: null, disposition: "unknown" },
    booking: null, attendance: { used: null, admitted: null, departed: null, inside: null, proof: "unverified", reasons: ["admission_relation_unverified"] },
    delivery: { issuance: "unverified", status: null, acceptance: "unverified", deliveryEvidence: "unverified", sentAt: null, deliveredAt: null,
      providerDeliveryStatus: null, providerStatusAt: null, sendVersion: null, attemptCount: null, safeFailureReasonCode: null },
    recovery: [],
    recent: {
      payments: { coverage: "not_applicable", limit: 10, order: "native_creation_desc", rows: [] },
      refunds: { coverage: "not_applicable", limit: 10, order: "recorded_updatedAt_desc", rows: [] },
      audit: { coverage: "complete", limit: 25, order: "native_creation_desc", rows: [], scope: "exception_series" }
    },
    coverage: { owner: "not_applicable", lines: "not_applicable", paid: "not_applicable", intentOwnership: "not_applicable", refunds: "not_applicable",
      booking: "not_applicable", admission: "not_applicable", delivery: "unverified", attempt: "not_applicable", webhook: "not_applicable" }
  };
}
export function billingPageFixture(): Mutable<BillingExceptionPage> {
  return { version: 1, role: "admin", query: { status: "open", limit: 25 }, retrievedAt: 1000, cutoff: 1000,
    startCursor: null, endCursor: null, page: [], continueCursor: null, splitCursor: null, pageStatus: null, isDone: true, segmentDone: true, capped: false };
}
export function billingPaidDetailFixture(): Mutable<BillingDetail> {
  const row = billingDetailFixture();
  row.exception.category = "billing"; row.exception.code = "paid_booking_proof_invalid"; row.exception.moneyReceived = true;
  row.exception.refs.orderRef = "SKY2610-ABC123";
  row.relation = { state: "correlated", reasons: [] };
  row.owner = { kind: "order", ref: "SKY2610-ABC123", status: "canceled", channel: "online", subtotalCents: 3000, feeCents: 0, totalCents: 3000,
    currency: "usd", visitDate: "2026-10-02", entryTime: "09:00", createdAt: 100, updatedAt: 900, dataIssues: [] };
  row.money = { paidFactRecorded: true, proof: "proven", reasons: [], provenPaidCents: 3000, currency: "usd" };
  row.refunds = { proof: "proven", reasons: [], succeededRefundCents: 1000, disposition: "partial" };
  row.coverage.owner = "complete"; row.coverage.paid = "complete"; row.coverage.intentOwnership = "complete"; row.coverage.refunds = "complete";
  return row;
}
