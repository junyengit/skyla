import {
  isBillingDisplayRef, isBillingVocabularyValue, parseVisitDate, parseVisitTime,
  type billingVocabularies, type BillingBackendReadError, type BillingDetail,
  type BillingException, type BillingExceptionPage, type BillingHttpError,
  type BillingHttpErrorCode, type BillingPageRequest
} from "@skyla/payments";

export type { BillingDetail, BillingExceptionPage, BillingPageRequest, BillingRole } from "@skyla/payments";

export class BillingRequestError extends Error {
  constructor() { super("Billing request could not be verified"); this.name = "BillingRequestError"; }
}
export class BillingResponseError extends Error {
  constructor() { super("Billing records could not be verified. Reload records."); this.name = "BillingResponseError"; }
}
function invalid(): never { throw new BillingResponseError(); }
type Check = (value: unknown) => unknown;
type Obj = Record<string, unknown>;
function object(value: unknown): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  return value as Obj;
}
function structure(fields: Record<string, Check>): Check {
  return value => {
    const input = object(value);
    const keys = Reflect.ownKeys(input);
    if (keys.length !== Object.keys(fields).length || keys.some(key => typeof key !== "string" || !Object.hasOwn(fields, key))) invalid();
    return Object.fromEntries(Object.entries(fields).map(([key, check]) => [key, check(input[key])]));
  };
}
function literal(expected: unknown): Check { return value => value === expected ? value : invalid(); }
function oneOf(...values: readonly unknown[]): Check { return value => values.includes(value) ? value : invalid(); }
function vocabulary<Key extends keyof typeof billingVocabularies>(key: Key): Check {
  return value => isBillingVocabularyValue(key, value) ? value : invalid();
}
function nullable(check: Check): Check { return value => value === null ? null : check(value); }
const bool: Check = value => typeof value === "boolean" ? value : invalid();
function integer(min = 0, max = Number.MAX_SAFE_INTEGER): Check {
  return value => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : invalid();
}
const timeStamp = integer();
const nativeTime: Check = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : invalid();
const text = (max: number): Check => value => typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value) ? value : invalid();
const id = text(256);
const cursor = nullable(text(8192));
const ref: Check = value => isBillingDisplayRef(value) ? value : invalid();
const date: Check = value => typeof value === "string" && parseVisitDate(value) === value ? value : invalid();
const wallTime: Check = value => typeof value === "string" && parseVisitTime(value) === value ? value : invalid();
const mask: Check = value => typeof value === "string" && /^(?:cs_|pi_|evt_|re_|msg_|id)…[A-Za-z0-9]{0,4}$/.test(value) && !/[\r\n]/.test(value) ? value : invalid();
function list(check: Check, max: number): Check {
  return value => Array.isArray(value) && value.length <= max ? value.map(check) : invalid();
}
const issues: Check = value => {
  const result = list(vocabulary("issueCodes"), 16)(value) as string[];
  return new Set(result).size === result.length ? result : invalid();
};
const refs: Check = value => {
  const result = structure({ orderRef: nullable(ref), saleRef: nullable(ref), bookingRef: nullable(ref) })(value) as Obj;
  if (result.orderRef !== null && result.saleRef !== null) invalid();
  return result;
};
const cents = nullable(integer());
const counter = nullable(integer());
const nullableTime = nullable(timeStamp);
const currency = nullable(literal("usd"));
const exceptionShape = structure({
  exceptionId: id, category: vocabulary("categories"), status: vocabulary("exceptionStatuses"),
  code: nullable(vocabulary("exceptionCodes")), refs,
  idsMasked: structure({ session: nullable(mask), paymentIntent: nullable(mask), providerEvent: nullable(mask), providerRefund: nullable(mask) }),
  moneyReceived: bool, amountCents: cents, currency, amountMeaning: literal("recorded_exception_amount"),
  occurrenceCount: integer(1), firstSeenAt: timeStamp, lastSeenAt: timeStamp,
  resolvedAt: nullableTime, resolutionCode: nullable(vocabulary("resolutionCodes")), resolutionRecorded: bool,
  recordedAt: nativeTime, dataIssues: issues
});
function exception(value: unknown): BillingException {
  const row = exceptionShape(value) as BillingException;
  if (row.firstSeenAt > row.lastSeenAt || (row.code === null && !row.dataIssues.includes("unrecognized_code"))) invalid();
  if (row.status === "open" && (row.resolvedAt !== null || row.resolutionRecorded || row.resolutionCode !== null)) invalid();
  if (row.status === "resolved" && (row.resolvedAt === null || row.resolvedAt < row.firstSeenAt)) invalid();
  if (row.resolutionCode !== null && !row.resolutionRecorded) invalid();
  return row;
}
const evidence = structure({
  source: nullable(vocabulary("evidenceSources")), eventType: nullable(vocabulary("eventTypes")), providerState: nullable(vocabulary("providerStates")), mode: nullable(vocabulary("modes")),
  moneyRecorded: nullable(bool), paidAt: nullableTime, attemptStatus: nullable(oneOf("creating", "creation_unknown", "open", "paid", "expired", "canceled", "rejected", "exception")),
  providerRequestCount: counter, reconcileCount: counter, sendVersion: nullable(integer(1)), attemptCount: counter, autoRetryCount: counter,
  providerTrackingCount: counter, providerDeliveryStatus: nullable(vocabulary("emailProviderStates")), refundStatus: nullable(vocabulary("refundStates")),
  providerEventCreatedAt: nullableTime, safeReasonCode: nullable(vocabulary("safeReasonCodes"))
});
const owner = structure({
  kind: vocabulary("ownerKinds"), ref: nullable(ref), status: nullable(vocabulary("ownerStates")), channel: vocabulary("channels"),
  subtotalCents: cents, feeCents: cents, totalCents: cents, currency, visitDate: nullable(date), entryTime: nullable(wallTime),
  createdAt: timeStamp, updatedAt: timeStamp, dataIssues: issues
});
const line = structure({
  rowId: id, kind: nullable(vocabulary("lineKinds")), admissionCategory: nullable(vocabulary("admissionCategories")),
  quantity: nullable(integer(1)), unitAmountCents: cents, lineTotalCents: cents, dataIssues: issues
});
const payment = structure({
  rowId: id, refs, provider: nullable(vocabulary("paymentProviders")), paymentIdMasked: mask, intentIdMasked: nullable(mask), eventIdMasked: nullable(mask),
  status: nullable(vocabulary("paymentStates")), amountCents: cents, currency, recordedAt: nativeTime, createdAt: timeStamp, dataIssues: issues
});
const refund = structure({
  rowId: id, refs, provider: nullable(oneOf("stripe", "terminal")), refundIdMasked: mask, intentIdMasked: mask, eventIdMasked: mask,
  status: nullable(vocabulary("refundStates")), amountCents: nullable(integer(1)), currency, providerEventCreatedAt: timeStamp,
  createdAt: timeStamp, updatedAt: timeStamp, reasonRecorded: bool, failureReasonRecorded: bool, dataIssues: issues
});
const audit = structure({
  rowId: id, action: nullable(vocabulary("auditActions")), entityType: oneOf("order", "posSale", "operationsException"), createdAt: timeStamp, recordedAt: nativeTime,
  facts: structure({ amountCents: cents, moneyReceived: nullable(bool), sendVersion: nullable(integer(1)), attemptCount: counter, safeReasonCode: nullable(vocabulary("safeReasonCodes")) }), dataIssues: issues
});
function pane(row: Check, limit: number, order: string, auditScope = false): Check {
  return structure({ coverage: vocabulary("coverages"), limit: literal(limit), order: literal(order), rows: list(row, limit), ...(auditScope ? { scope: vocabulary("auditScopes") } : {}) });
}
const booking = structure({
  bookingRef: nullable(ref), refs, status: nullable(vocabulary("bookingStates")), visitDate: nullable(date), entryTime: nullable(wallTime),
  partySize: nullable(integer(1, 30)), cancelledAt: nullableTime, paidProof: vocabulary("bookingProofs"), reasons: issues
});
const delivery = structure({
  issuance: vocabulary("issuances"), status: nullable(vocabulary("deliveryStates")), acceptance: vocabulary("recordedEvidence"), deliveryEvidence: vocabulary("recordedEvidence"),
  sentAt: nullableTime, deliveredAt: nullableTime, providerDeliveryStatus: nullable(vocabulary("emailProviderStates")), providerStatusAt: nullableTime,
  sendVersion: nullable(integer(1)), attemptCount: counter, safeFailureReasonCode: nullable(vocabulary("safeReasonCodes"))
});
const recovery = structure({
  kind: vocabulary("recoveryKinds"), state: nullable(oneOf("creating", "creation_unknown", "open", "paid", "expired", "canceled", "rejected", "exception", "queued", "sending", "sent", "failed", "suppressed")),
  correlation: oneOf("correlated", "unverified"), reasons: issues, mode: nullable(vocabulary("modes")), apiVersion: nullable(vocabulary("apiVersions")),
  providerState: nullable(vocabulary("providerStates")), safeStopReasonCode: nullable(vocabulary("safeReasonCodes")), lastErrorRecorded: bool, safeLastErrorCode: nullable(vocabulary("safeReasonCodes")),
  providerRequestCount: counter, reconcileCount: counter, readerProcessCount: counter, autoRetryCount: counter, trackingCount: counter,
  firstProviderRequestAt: nullableTime, lastProviderRequestAt: nullableTime, lastReconciliationAttemptAt: nullableTime, lastReaderProcessAt: nullableTime,
  lastEmailAttemptAt: nullableTime, settledAt: nullableTime, nextDueAt: nullableTime, leaseExpiresAt: nullableTime, readerLeaseExpiresAt: nullableTime, schedule: vocabulary("schedules")
});
const coverage = structure(Object.fromEntries(["owner", "lines", "paid", "intentOwnership", "refunds", "booking", "admission", "delivery", "attempt", "webhook"].map(key => [key, vocabulary("coverages")])));
const detail = structure({
  version: literal(1), role: vocabulary("roles"), lookup: structure({ exceptionId: id }), retrievedAt: timeStamp, exception, evidence,
  relation: structure({ state: vocabulary("relations"), reasons: issues }), owner: nullable(owner),
  lines: structure({ coverage: vocabulary("coverages"), rows: list(line, 100) }),
  money: structure({ paidFactRecorded: bool, proof: vocabulary("proofs"), reasons: issues, provenPaidCents: cents, currency }),
  refunds: structure({ proof: vocabulary("proofs"), reasons: issues, succeededRefundCents: cents, disposition: vocabulary("refundDispositions") }),
  booking: nullable(booking), attendance: structure({ used: nullable(bool), admitted: nullable(integer(1, 30)), departed: nullable(integer(0, 30)), inside: nullable(integer(0, 30)), proof: vocabulary("attendanceProofs"), reasons: issues }),
  delivery, recovery: list(recovery, 4), recent: structure({ payments: pane(payment, 10, "native_creation_desc"), refunds: pane(refund, 10, "recorded_updatedAt_desc"), audit: pane(audit, 25, "native_creation_desc", true) }), coverage
});
function bounded(value: unknown) {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 256 * 1024) invalid();
}
function checked<T>(value: unknown, check: () => T): T {
  try { bounded(value); return check(); } catch { return invalid(); }
}
function parameters(params: URLSearchParams, keys: readonly string[]) {
  for (const key of params.keys()) if (!keys.includes(key) || params.getAll(key).length !== 1) throw new BillingRequestError();
}
export function normalizeBillingPageRequest(params: URLSearchParams): BillingPageRequest {
  try {
    parameters(params, ["page", "status", "limit", "cursor", "endCursor"]);
    if (params.get("page") !== "1") throw new BillingRequestError();
    const status = params.get("status") ?? "open";
    if (!isBillingVocabularyValue("exceptionStatuses", status)) throw new BillingRequestError();
    const rawLimit = params.get("limit") ?? "25";
    if (!/^\d{1,2}$/.test(rawLimit)) throw new BillingRequestError();
    return { status, limit: integer(1, 50)(Number(rawLimit)) as number, cursor: cursor(params.get("cursor")) as string | null, endCursor: cursor(params.get("endCursor")) as string | null };
  } catch { throw new BillingRequestError(); }
}
export function normalizeBillingDetailRequest(params: URLSearchParams): { exceptionId: string } {
  try { parameters(params, ["exceptionId"]); return { exceptionId: id(params.get("exceptionId")) as string }; }
  catch { throw new BillingRequestError(); }
}
export function parseBillingExceptionPage(value: unknown, expected: BillingPageRequest & { cutoff?: number; role?: "admin" | "viewer" }): BillingExceptionPage {
  return checked(value, () => {
    const row = structure({ version: literal(1), role: vocabulary("roles"), query: structure({ status: vocabulary("exceptionStatuses"), limit: integer(1, 50) }),
      retrievedAt: timeStamp, cutoff: timeStamp, startCursor: cursor, endCursor: cursor, page: list(exception, 100), continueCursor: cursor, splitCursor: cursor,
      pageStatus: nullable(vocabulary("pageStatuses")), isDone: bool, segmentDone: bool, capped: bool })(value) as BillingExceptionPage;
    if (row.query.status !== expected.status || row.query.limit !== expected.limit || row.startCursor !== expected.cursor || row.endCursor !== expected.endCursor ||
        row.cutoff > row.retrievedAt || (expected.cutoff !== undefined && row.cutoff !== expected.cutoff) || (expected.role !== undefined && row.role !== expected.role) || row.capped !== !row.isDone) invalid();
    if (row.pageStatus !== null) {
      if (row.isDone || row.segmentDone || !row.continueCursor || !row.splitCursor || row.continueCursor === row.splitCursor || row.continueCursor === row.startCursor || row.splitCursor === row.startCursor) invalid();
    } else {
      if (row.splitCursor !== null || row.segmentDone !== (row.continueCursor === null) || (row.endCursor === null ? row.isDone !== row.segmentDone : row.isDone)) invalid();
      if (row.continueCursor !== null && row.continueCursor === row.startCursor) invalid();
    }
    const seen = new Set<string>(); let previous = Infinity;
    for (const item of row.page) {
      if (item.status !== row.query.status || item.recordedAt > row.cutoff || item.recordedAt > previous || seen.has(item.exceptionId)) invalid();
      seen.add(item.exceptionId); previous = item.recordedAt;
    }
    return row;
  });
}
function nonemptyReasons(state: string, reasons: readonly string[], good: readonly string[]) {
  if (!good.includes(state) && reasons.length === 0) invalid();
}
function uniqueRows(rows: readonly { rowId: string }[]) { if (new Set(rows.map(row => row.rowId)).size !== rows.length) invalid(); }
function verifiedNoAdmissionLines(row: BillingDetail) {
  if (row.relation.state !== "correlated" || !row.owner?.ref || row.coverage.owner !== "complete" || row.lines.coverage !== "complete" || row.coverage.lines !== "complete" || !row.lines.rows.length || row.owner.subtotalCents === null) return false;
  let subtotal = 0;
  for (const line of row.lines.rows) {
    if (line.kind === null || line.kind === "ticket" || line.quantity === null || line.unitAmountCents === null || line.lineTotalCents === null || line.dataIssues.length ||
        !Number.isSafeInteger(line.quantity * line.unitAmountCents) || line.quantity * line.unitAmountCents !== line.lineTotalCents) return false;
    subtotal += line.lineTotalCents;
    if (!Number.isSafeInteger(subtotal)) return false;
  }
  return subtotal === row.owner.subtotalCents;
}
function exactBookingRelation(row: BillingDetail) {
  const owner = row.owner, booking = row.booking;
  return row.relation.state === "correlated" && row.coverage.owner === "complete" && row.coverage.booking === "complete" &&
    owner !== null && owner.ref !== null && booking !== null && booking.bookingRef !== null && booking.refs.bookingRef === booking.bookingRef &&
    (row.exception.refs.bookingRef === null || row.exception.refs.bookingRef === booking.bookingRef) &&
    (owner.kind === "order" ? booking.refs.orderRef === owner.ref && booking.refs.saleRef === null : booking.refs.saleRef === owner.ref && booking.refs.orderRef === null);
}
export function parseBillingDetail(value: unknown, expected: { exceptionId: string; role?: "admin" | "viewer" }): BillingDetail {
  return checked(value, () => {
    const row = detail(value) as BillingDetail;
    if (row.lookup.exceptionId !== expected.exceptionId || row.exception.exceptionId !== expected.exceptionId || (expected.role !== undefined && row.role !== expected.role) || row.lines.coverage !== row.coverage.lines) invalid();
    nonemptyReasons(row.relation.state, row.relation.reasons, ["correlated"]);
    nonemptyReasons(row.money.proof, row.money.reasons, ["proven"]);
    nonemptyReasons(row.refunds.proof, row.refunds.reasons, ["proven"]);
    if (row.owner) {
      const owner = row.owner;
      if (owner.channel !== (owner.kind === "order" ? "online" : "pos")) invalid();
      const storedRef = owner.kind === "order" ? row.exception.refs.orderRef : row.exception.refs.saleRef;
      if (owner.ref !== null && storedRef !== null && owner.ref !== storedRef) invalid();
      if (owner.subtotalCents !== null && owner.feeCents !== null && owner.totalCents !== null &&
          (!Number.isSafeInteger(owner.subtotalCents + owner.feeCents) || owner.subtotalCents + owner.feeCents !== owner.totalCents) && !owner.dataIssues.includes("invalid_owner_total")) invalid();
    }
    if (row.relation.state === "correlated" && (!row.owner?.ref || row.coverage.owner !== "complete" ||
        (row.owner.kind === "order" ? row.exception.refs.orderRef !== row.owner.ref || row.exception.refs.saleRef !== null
          : row.exception.refs.saleRef !== row.owner.ref || row.exception.refs.orderRef !== null))) invalid();
    for (const line of row.lines.rows) {
      if (line.quantity !== null && line.unitAmountCents !== null && line.lineTotalCents !== null &&
          (!Number.isSafeInteger(line.quantity * line.unitAmountCents) || line.quantity * line.unitAmountCents !== line.lineTotalCents) && !line.dataIssues.includes("invalid_line_total")) invalid();
    }
    uniqueRows(row.lines.rows); uniqueRows(row.recent.payments.rows); uniqueRows(row.recent.refunds.rows); uniqueRows(row.recent.audit.rows);
    for (const pane of [row.recent.payments, row.recent.refunds, row.recent.audit]) {
      if ((pane.coverage === "not_applicable" && pane.rows.length !== 0) || (pane.coverage === "capped" && pane.rows.length !== pane.limit)) invalid();
    }
    for (const rows of [row.recent.payments.rows, row.recent.audit.rows]) {
      if (rows.some((item, index) => index > 0 && item.recordedAt > rows[index - 1]!.recordedAt)) invalid();
    }
    if (row.recent.refunds.rows.some((item, index) => index > 0 && item.updatedAt > row.recent.refunds.rows[index - 1]!.updatedAt)) invalid();
    for (const item of row.recent.audit.rows) {
      if ((item.action?.startsWith("checkout.") && item.entityType !== "order") || (item.action?.startsWith("pos.") && item.entityType !== "posSale") ||
          (item.action?.startsWith("payment.refund.") && item.entityType === "operationsException") || (item.action === null && !item.dataIssues.includes("unrecognized_action"))) invalid();
    }
    if (row.recent.audit.scope === "owner" && !row.owner) invalid();
    const category = row.exception.category;
    if (category === "checkout_attempt" || category === "terminal_attempt") {
      const stateKey = category === "checkout_attempt" ? "checkoutProviderStates" : "terminalProviderStates";
      const attemptKey = category === "checkout_attempt" ? "checkoutAttemptStates" : "terminalAttemptStates";
      if ((row.evidence.providerState !== null && !isBillingVocabularyValue(stateKey, row.evidence.providerState)) ||
          (row.evidence.attemptStatus !== null && !isBillingVocabularyValue(attemptKey, row.evidence.attemptStatus))) invalid();
    } else if (row.evidence.attemptStatus !== null) invalid();
    if (category === "ticket_delivery" && row.evidence.providerState !== null && !isBillingVocabularyValue("emailProviderStates", row.evidence.providerState)) invalid();
    if (row.money.proof === "proven") {
      if (!row.money.paidFactRecorded || !row.owner || row.relation.state !== "correlated" || row.money.provenPaidCents === null || row.money.provenPaidCents <= 0 || row.money.currency !== "usd" || row.owner.currency !== "usd" ||
          row.owner.totalCents !== row.money.provenPaidCents || row.owner.subtotalCents === null || row.owner.feeCents === null || !Number.isSafeInteger(row.owner.subtotalCents + row.owner.feeCents) || row.owner.subtotalCents + row.owner.feeCents !== row.owner.totalCents || row.coverage.paid !== "complete" || row.coverage.intentOwnership !== "complete") invalid();
    } else if (row.money.provenPaidCents !== null || row.money.currency !== null) invalid();
    if (row.money.proof === "none_recorded" && row.money.paidFactRecorded) invalid();
    if (row.refunds.proof === "proven") {
      const sum = row.refunds.succeededRefundCents, paid = row.money.provenPaidCents;
      if (row.money.proof !== "proven" || row.coverage.refunds !== "complete" || sum === null || paid === null || sum > paid ||
          row.refunds.disposition !== (sum === 0 ? "none_succeeded_recorded" : sum === paid ? "full" : "partial")) invalid();
    } else if (row.refunds.succeededRefundCents !== null || row.refunds.disposition !== "unknown") invalid();
    if (row.booking) {
      nonemptyReasons(row.booking.paidProof, row.booking.reasons, ["proven"]);
      if (row.booking.paidProof === "proven" && (!exactBookingRelation(row) || !row.booking.visitDate || !row.booking.entryTime || !row.owner?.visitDate || !row.owner.entryTime || !row.booking.bookingRef || row.money.proof !== "proven" || row.refunds.proof !== "proven" || row.refunds.disposition === "full" || row.coverage.booking !== "complete" || !row.booking.partySize || row.booking.status === null ||
          row.booking.refs.bookingRef !== row.booking.bookingRef || !row.owner || row.booking.visitDate !== row.owner.visitDate || row.booking.entryTime !== row.owner.entryTime ||
          (row.owner.kind === "order" ? row.booking.refs.orderRef !== row.owner.ref || row.booking.refs.saleRef !== null : row.booking.refs.saleRef !== row.owner.ref || row.booking.refs.orderRef !== null) ||
          (row.exception.refs.bookingRef !== null && row.exception.refs.bookingRef !== row.booking.bookingRef))) invalid();
    }
    nonemptyReasons(row.attendance.proof, row.attendance.reasons, ["proven", "not_applicable"]);
    const a = row.attendance;
    if (a.proof === "proven" && (!exactBookingRelation(row) || row.coverage.admission !== "complete")) invalid();
    if (a.proof === "proven" && a.used === true && (!row.booking?.visitDate || row.booking.partySize !== a.admitted || a.admitted === null || a.departed === null || a.inside === null || a.departed > a.admitted || a.inside !== a.admitted - a.departed)) invalid();
    if (a.proof !== "proven" && (a.admitted !== null || a.departed !== null || a.inside !== null)) invalid();
    if (a.proof === "proven" && a.used === null) invalid();
    if (a.proof === "not_applicable" && (a.used !== null || row.booking !== null || row.exception.refs.bookingRef !== null || row.coverage.booking !== "not_applicable" || row.coverage.admission !== "not_applicable" || !verifiedNoAdmissionLines(row))) invalid();
    if (a.used === false && (a.proof !== "proven" || !row.booking || row.booking.status === "checked-in" || row.coverage.booking !== "complete" || row.coverage.admission !== "complete" || a.admitted !== null || a.departed !== null || a.inside !== null)) invalid();
    if (row.delivery.issuance === "not_applicable" && !verifiedNoAdmissionLines(row)) invalid();
    if ((row.delivery.acceptance === "recorded" || row.delivery.deliveryEvidence === "recorded") &&
        (row.delivery.issuance !== "issued" || row.coverage.delivery !== "complete" || !exactBookingRelation(row))) invalid();
    if (row.delivery.acceptance === "recorded" && (row.delivery.sentAt === null || row.delivery.sendVersion === null || !row.delivery.attemptCount || !["sent", "suppressed"].includes(row.delivery.status ?? ""))) invalid();
    if (row.delivery.deliveryEvidence === "recorded" && (row.delivery.acceptance !== "recorded" || row.delivery.deliveredAt === null || row.delivery.sentAt === null || row.delivery.deliveredAt < row.delivery.sentAt || row.delivery.providerStatusAt === null || row.delivery.providerStatusAt < row.delivery.deliveredAt)) invalid();
    if (row.delivery.deliveredAt !== null && row.delivery.deliveryEvidence === "none_recorded") invalid();
    if (new Set(row.recovery.map(item => item.kind)).size !== row.recovery.length) invalid();
    for (const item of row.recovery) {
      nonemptyReasons(item.correlation, item.reasons, ["correlated"]);
      const states = item.kind === "checkout" ? "checkoutAttemptStates" : item.kind === "terminal" ? "terminalAttemptStates" : "deliveryStates";
      const providerStates = item.kind === "checkout" ? "checkoutProviderStates" : item.kind === "terminal" ? "terminalProviderStates" : "emailProviderStates";
      if ((item.state !== null && !isBillingVocabularyValue(states, item.state)) || (item.providerState !== null && !isBillingVocabularyValue(providerStates, item.providerState))) invalid();
      if (item.correlation === "correlated" && (row.relation.state !== "correlated" || !row.owner || row.coverage.owner !== "complete" ||
          (item.kind === "checkout" ? row.owner.kind !== "order" || row.coverage.attempt !== "complete"
            : item.kind === "terminal" ? row.owner.kind !== "sale" || row.coverage.attempt !== "complete"
              : row.delivery.issuance !== "issued" || row.coverage.delivery !== "complete" || !exactBookingRelation(row)))) invalid();
      if (item.correlation === "unverified" && item.schedule !== "unverified") invalid();
      if (item.safeLastErrorCode !== null && !item.lastErrorRecorded) invalid();
      if (item.schedule === "stopped" && item.safeStopReasonCode === null) invalid();
      if (item.schedule === "scheduled" && item.nextDueAt === null) invalid();
      if (item.schedule === "active_lease" && ![item.leaseExpiresAt, item.readerLeaseExpiresAt].some(at => at !== null && at > row.retrievedAt)) invalid();
      if ((item.schedule === "none_recorded" || item.schedule === "stopped") && item.nextDueAt !== null) invalid();
    }
    return row;
  });
}
/** Caller must first verify an actual ConvexError instance. */
export function parseBillingBackendReadError(value: unknown, expected?: { exceptionId: string }): BillingBackendReadError {
  return checked(value, () => {
    const input = object(value);
    if (input.code === "billing_record_not_found") {
      const result = structure({ kind: literal("billing_read_error"), version: literal(1), code: literal("billing_record_not_found"), lookup: structure({ exceptionId: id }) })(value) as BillingBackendReadError;
      if (!expected || !("lookup" in result) || result.lookup.exceptionId !== expected.exceptionId) invalid();
      return result;
    }
    return structure({ kind: literal("billing_read_error"), version: literal(1), code: oneOf("billing_access_denied", "billing_cursor_invalid", "billing_read_unverified") })(value) as BillingBackendReadError;
  });
}
export function billingHttpFailure(code: BillingHttpErrorCode): { body: BillingHttpError; status: number } {
  const status = code === "billing_request_rejected" || code === "billing_cursor_invalid" ? 400 : code === "billing_auth_required" ? 401 : code === "billing_access_denied" ? 403 : code === "billing_record_not_found" ? 404 : 502;
  const error = code === "billing_auth_required" || code === "billing_access_denied" ? "Staff access could not be verified." : code === "billing_request_rejected" || code === "billing_cursor_invalid" ? "Billing request could not be verified. Reload records." : code === "billing_record_not_found" ? "The selected exception record was not found." : "Billing records could not be verified. Reload records.";
  return { body: { error, code }, status };
}
