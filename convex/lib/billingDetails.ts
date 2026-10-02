import {
  billingVocabularies as vocab, isBillingDisplayRef, isBillingVocabularyValue,
  parseVisitDate, parseVisitTime,
  type BillingBackendReadError, type BillingDetail, type BillingException,
  type BillingEvidence, type BillingIssueCode, type BillingRole, type BillingOwnerRecord,
  type BillingLine, type BillingPaymentRow, type BillingRefundRow, type BillingAuditRow,
  type BillingRecovery, type BillingDelivery, type BillingCoverage, type BillingRefs, type BillingPageRequest
} from "@skyla/payments";
import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { bookingPaidProof } from "./admission";
import { lookupBookingAdmission, remainingAdmissionParty } from "./occupancy";
import {
  checkIntentOwnership, paidIdentityForIntent, paidIdentityForProviderPayment,
  paidSummaryForOrder, paidSummaryForSale, samePaidRecord
} from "./paymentEvidence";

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };
type Raw = Record<string, unknown> & { _id: string; _creationTime: number };
type Owner = { kind: "order" | "sale"; ref: string; row: Doc<"orders"> | Doc<"posSales"> };
type IssueList = BillingIssueCode[];
export const billingDetailReadMaximum = 8192;
export const billingDetailPlannedReads = 7914;
export const billingOutputByteMaximum = 256 * 1024;

class BillingReadError extends ConvexError<BillingBackendReadError> {}
export function billingReadFailure(code: BillingBackendReadError["code"], exceptionId?: string): never {
  const data: BillingBackendReadError = code === "billing_record_not_found"
    ? { kind: "billing_read_error", version: 1, code, lookup: { exceptionId: exceptionId! } }
    : { kind: "billing_read_error", version: 1, code };
  throw new BillingReadError(data);
}
export function rethrowBillingRead(error: unknown): never {
  if (error instanceof BillingReadError) throw error;
  return billingReadFailure("billing_read_unverified");
}

/** Same admin/viewer policy, but denial is attested from observed persisted facts. */
export async function requireBillingStaff(ctx: QueryCtx): Promise<BillingRole> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return billingReadFailure("billing_access_denied");
  if (typeof identity.subject !== "string" || !identity.subject) return billingReadFailure("billing_read_unverified");
  const rows = await ctx.db.query("staffUsers").withIndex("by_subject", q => q.eq("subject", identity.subject)).take(2);
  if (rows.length > 1) return billingReadFailure("billing_read_unverified");
  const staff = rows[0];
  if (!staff || staff.active === false || staff.role === "pos") return billingReadFailure("billing_access_denied");
  if (staff.active !== true || (staff.role !== "admin" && staff.role !== "viewer")) return billingReadFailure("billing_read_unverified");
  return staff.role;
}
class ReadBudget {
  private maximum = 0;
  reserve(maximum: number) {
    this.maximum += maximum;
    if (this.maximum > billingDetailReadMaximum) billingReadFailure("billing_read_unverified");
  }
}
function issue(target: IssueList, value: BillingIssueCode) {
  if (!target.includes(value) && target.length < 16) target.push(value);
}
function known<K extends keyof typeof vocab>(key: K, value: unknown, issues: IssueList, failure: BillingIssueCode = "unrecognized_state"): (typeof vocab)[K][number] | null {
  if (value === undefined || value === null) return null;
  if (isBillingVocabularyValue(key, value)) return value as (typeof vocab)[K][number];
  issue(issues, failure); return null;
}
function integer(value: unknown, issues: IssueList, failure: BillingIssueCode, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum) return value;
  issue(issues, failure); return null;
}
function requiredTimestamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return billingReadFailure("billing_read_unverified");
  return value;
}
function nativeTimestamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return billingReadFailure("billing_read_unverified");
  return value;
}
function recordId(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) return billingReadFailure("billing_read_unverified");
  return value;
}
function internalRef(value: unknown): string | null {
  return typeof value === "string" && !!value && value.trim() === value && value.length <= 80 && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
}
function displayRef(value: unknown, issues: IssueList): string | null {
  if (value === undefined || value === null) return null;
  if (isBillingDisplayRef(value)) return value;
  issue(issues, "invalid_ref"); return null;
}
function refs(row: { orderRef?: unknown; saleRef?: unknown; bookingRef?: unknown }, issues: IssueList): BillingRefs {
  const conflict = row.orderRef !== undefined && row.saleRef !== undefined;
  if (conflict) issue(issues, "owner_ref_conflict");
  return { orderRef: conflict ? null : displayRef(row.orderRef, issues), saleRef: conflict ? null : displayRef(row.saleRef, issues), bookingRef: displayRef(row.bookingRef, issues) };
}
/** Always redacted, including short IDs and unsafe provider contents. Never used to join. */
export function maskBillingId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return "id…";
  const prefix = /^(cs_|pi_|evt_|re_|msg_)/.exec(value)?.[0] ?? "id";
  const suffix = value.length > 8 && /^[A-Za-z0-9]{4}$/.test(value.slice(-4)) ? value.slice(-4) : "";
  return `${prefix}…${suffix}`;
}
function date(value: unknown, issues: IssueList) {
  if (value === undefined) return null;
  const parsed = parseVisitDate(value); if (!parsed) issue(issues, "invalid_visit_date"); return parsed;
}
function time(value: unknown, issues: IssueList) {
  if (value === undefined) return null;
  const parsed = parseVisitTime(value); if (!parsed) issue(issues, "invalid_entry_time"); return parsed;
}
function currency(value: unknown, issues: IssueList): "usd" | null {
  if (value === "usd") return "usd";
  if (value !== undefined) issue(issues, "invalid_currency"); return null;
}
function boolean(value: unknown): boolean | null { return typeof value === "boolean" ? value : null; }
function safeReason(value: unknown, issues: IssueList) {
  return known("safeReasonCodes", value, issues, "unsafe_reason_withheld");
}
export function assertBillingOutput(value: unknown) {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > billingOutputByteMaximum) billingReadFailure("billing_read_unverified");
}

export function projectBillingException(row: Doc<"operationsExceptions">): BillingException {
  const dataIssues: IssueList = [];
  const category = known("categories", row.category, dataIssues);
  const status = known("exceptionStatuses", row.status, dataIssues);
  if (!category || !status || typeof row.moneyReceived !== "boolean" || !Number.isSafeInteger(row.occurrenceCount) || row.occurrenceCount < 1) billingReadFailure("billing_read_unverified");
  const firstSeenAt = requiredTimestamp(row.firstSeenAt), lastSeenAt = requiredTimestamp(row.lastSeenAt);
  const resolvedAt = integer(row.resolvedAt, dataIssues, "invalid_timestamp");
  if (firstSeenAt > lastSeenAt || (status === "open" && (row.resolvedAt !== undefined || row.resolution !== undefined)) ||
      (status === "resolved" && (resolvedAt === null || resolvedAt < firstSeenAt))) billingReadFailure("billing_read_unverified");
  return {
    exceptionId: recordId(row._id), category, status,
    code: known("exceptionCodes", row.code, dataIssues, "unrecognized_code"), refs: refs(row, dataIssues),
    idsMasked: { session: maskBillingId(row.providerSessionId), paymentIntent: maskBillingId(row.providerPaymentIntentId),
      providerEvent: maskBillingId(row.providerEventId), providerRefund: maskBillingId(row.evidence?.providerRefundId) },
    moneyReceived: row.moneyReceived, amountCents: integer(row.amountCents, dataIssues, "invalid_amount"), currency: currency(row.currency, dataIssues),
    amountMeaning: "recorded_exception_amount", occurrenceCount: row.occurrenceCount,
    firstSeenAt, lastSeenAt, resolvedAt,
    resolutionCode: known("resolutionCodes", row.resolution, dataIssues, "unsafe_reason_withheld"), resolutionRecorded: row.resolution !== undefined,
    recordedAt: nativeTimestamp(row._creationTime), dataIssues
  };
}
function projectEvidence(row: Doc<"operationsExceptions">, issues: IssueList): BillingEvidence {
  const e = row.evidence ?? {};
  const stateKey = row.category === "terminal_attempt" ? "terminalProviderStates" : row.category === "checkout_attempt" ? "checkoutProviderStates" : row.category === "ticket_delivery" ? "emailProviderStates" : "providerStates";
  return {
    source: known("evidenceSources", e.source, issues), eventType: known("eventTypes", e.eventType, issues, "unrecognized_event_type"),
    providerState: known(stateKey, e.providerState, issues), mode: typeof e.livemode === "boolean" ? e.livemode ? "live" : "test" : null,
    moneyRecorded: boolean(e.moneyRecorded), paidAt: integer(e.paidAt, issues, "invalid_timestamp"),
    attemptStatus: row.category === "terminal_attempt" ? known("terminalAttemptStates", e.attemptStatus, issues) : row.category === "checkout_attempt" ? known("checkoutAttemptStates", e.attemptStatus, issues) : null,
    providerRequestCount: integer(e.providerRequestCount, issues, "invalid_counter"), reconcileCount: integer(e.reconcileCount, issues, "invalid_counter"),
    sendVersion: integer(e.sendVersion, issues, "invalid_counter", 1), attemptCount: integer(e.attemptCount, issues, "invalid_counter"),
    autoRetryCount: integer(e.autoRetryCount, issues, "invalid_counter"), providerTrackingCount: integer(e.providerTrackingCount, issues, "invalid_counter"),
    providerDeliveryStatus: known("emailProviderStates", e.providerDeliveryStatus, issues), refundStatus: known("refundStates", e.refundStatus, issues),
    providerEventCreatedAt: integer(e.providerEventCreatedAt, issues, "invalid_timestamp"), safeReasonCode: safeReason(e.reason, issues)
  };
}
function projectOwner(owner: Owner): BillingOwnerRecord {
  const dataIssues: IssueList = [];
  const row = owner.row;
  const subtotalCents = integer(row.subtotalCents, dataIssues, "invalid_amount");
  const feeCents = integer(row.feeCents, dataIssues, "invalid_amount");
  const totalCents = integer(row.totalCents, dataIssues, "invalid_amount");
  if (subtotalCents === null || feeCents === null || totalCents === null || !Number.isSafeInteger(subtotalCents + feeCents) || subtotalCents + feeCents !== totalCents) issue(dataIssues, "invalid_owner_total");
  return { kind: owner.kind, ref: displayRef(owner.ref, dataIssues), channel: owner.kind === "order" ? "online" : "pos",
    status: known("ownerStates", row.status, dataIssues), subtotalCents, feeCents, totalCents, currency: currency(row.currency, dataIssues),
    visitDate: date(row.visitDate, dataIssues), entryTime: time(row.entryTime, dataIssues),
    createdAt: requiredTimestamp(row.createdAt), updatedAt: requiredTimestamp(row.updatedAt), dataIssues };
}
export function projectBillingLine(row: Doc<"orderLineItems"> | Doc<"posSaleLines">): BillingLine {
  const dataIssues: IssueList = [];
  const quantity = integer(row.quantity, dataIssues, "invalid_quantity", 1);
  const unitAmountCents = integer(row.unitAmountCents, dataIssues, "invalid_amount");
  const lineTotalCents = integer(row.lineTotalCents, dataIssues, "invalid_amount");
  if (quantity === null || unitAmountCents === null || lineTotalCents === null || !Number.isSafeInteger(quantity * unitAmountCents) || quantity * unitAmountCents !== lineTotalCents) issue(dataIssues, "invalid_line_total");
  return { rowId: recordId(row._id), kind: known("lineKinds", row.kind, dataIssues),
    admissionCategory: known("admissionCategories", row.metadata?.ageCategory, dataIssues), quantity, unitAmountCents, lineTotalCents, dataIssues };
}
function projectPayment(row: Doc<"paymentEvents">): BillingPaymentRow {
  const dataIssues: IssueList = [];
  return { rowId: recordId(row._id), refs: refs(row, dataIssues), provider: known("paymentProviders", row.provider, dataIssues),
    paymentIdMasked: maskBillingId(row.providerPaymentId) ?? "id…", intentIdMasked: maskBillingId(row.providerPaymentIntentId), eventIdMasked: maskBillingId(row.rawEventId),
    status: known("paymentStates", row.status, dataIssues), amountCents: integer(row.amountCents, dataIssues, "invalid_amount"), currency: currency(row.currency, dataIssues),
    createdAt: requiredTimestamp(row.createdAt), recordedAt: nativeTimestamp(row._creationTime), dataIssues };
}
function projectRefund(row: Doc<"refunds">): BillingRefundRow {
  const dataIssues: IssueList = [];
  const provider = row.paymentProvider === "stripe" || row.paymentProvider === "terminal" ? row.paymentProvider : null;
  if (provider === null) issue(dataIssues, "unrecognized_state");
  return { rowId: recordId(row._id), refs: refs(row, dataIssues), provider,
    refundIdMasked: maskBillingId(row.providerRefundId) ?? "id…", intentIdMasked: maskBillingId(row.providerPaymentIntentId) ?? "id…", eventIdMasked: maskBillingId(row.rawEventId) ?? "id…",
    status: known("refundStates", row.status, dataIssues), amountCents: integer(row.amountCents, dataIssues, "invalid_amount", 1), currency: currency(row.currency, dataIssues),
    providerEventCreatedAt: requiredTimestamp(row.providerEventCreatedAt), createdAt: requiredTimestamp(row.createdAt), updatedAt: requiredTimestamp(row.updatedAt),
    reasonRecorded: row.reason !== undefined, failureReasonRecorded: row.failureReason !== undefined, dataIssues };
}
function projectAudit(row: Doc<"auditEvents">, entityType: "order" | "posSale" | "operationsException"): BillingAuditRow {
  const dataIssues: IssueList = [];
  const m = row.metadata ?? {};
  const allowedAction = entityType === "operationsException" ? row.action === "operations.exceptionOpened" || row.action === "operations.exceptionResolved"
    : entityType === "order" ? row.action === "checkout.capacityException" || row.action.startsWith("payment.refund.")
      : row.action.startsWith("pos.") || row.action.startsWith("payment.refund.");
  const action = allowedAction ? known("auditActions", row.action, dataIssues, "unrecognized_action") : null;
  if (!allowedAction) issue(dataIssues, "unrecognized_action");
  return { rowId: recordId(row._id), action, entityType,
    createdAt: requiredTimestamp(row.createdAt), recordedAt: nativeTimestamp(row._creationTime),
    facts: { amountCents: integer(m.amountCents, dataIssues, "invalid_amount"), moneyReceived: boolean(m.moneyReceived),
      sendVersion: integer(m.sendVersion, dataIssues, "invalid_counter", 1), attemptCount: integer(m.attemptCount, dataIssues, "invalid_counter"),
      safeReasonCode: safeReason(m.code ?? m.safeReasonCode, dataIssues) }, dataIssues };
}
function ownerMatches(row: { orderRef?: string; saleRef?: string }, owner: Owner) {
  return owner.kind === "order" ? row.orderRef === owner.ref && row.saleRef === undefined : row.saleRef === owner.ref && row.orderRef === undefined;
}
async function readMoney(ctx: QueryCtx, owner: Owner | null, relation: BillingDetail["relation"], budget: ReadBudget) {
  const reasons: IssueList = [];
  let coverage: BillingCoverage = owner ? "complete" : "not_applicable";
  let ownershipCoverage: BillingCoverage = owner ? "unverified" : "not_applicable";
  const summary = owner ? (budget.reserve(101), owner.kind === "order" ? await paidSummaryForOrder(ctx, owner.ref) : await paidSummaryForSale(ctx, owner.ref)) : null;
  const money: Mutable<BillingDetail["money"]> = { paidFactRecorded: !!summary?.rows.length, proof: "unverified", reasons, provenPaidCents: null, currency: null };
  const fail = (proof: "unverified" | "conflict" | "none_recorded", reason: BillingIssueCode) => { money.proof = proof; issue(reasons, reason); return { money, coverage, ownershipCoverage, paid: null }; };
  if (!owner) return fail("unverified", relation.state === "ambiguous" ? "owner_ambiguous" : "owner_missing");
  if (summary!.overflow) { coverage = "capped"; return fail("unverified", "paid_history_capped"); }
  if (relation.state !== "correlated") return fail("unverified", "invalid_ref");
  if (!summary!.rows.length) return fail("none_recorded", "paid_none_recorded");
  if (summary!.rows.length !== 1) return fail("conflict", "paid_identity_duplicate");
  const paid = summary!.rows[0];
  const provider = owner.kind === "order" ? "stripe" : "terminal";
  const total = owner.row.totalCents;
  if (![owner.row.subtotalCents, owner.row.feeCents, total].every(amount => Number.isSafeInteger(amount) && amount >= 0) ||
      !Number.isSafeInteger(owner.row.subtotalCents + owner.row.feeCents) || owner.row.subtotalCents + owner.row.feeCents !== total) return fail("conflict", "invalid_owner_total");
  if (!paid.providerPaymentIntentId || !paid.providerPaymentId || paid.provider !== provider || !ownerMatches(paid, owner) ||
      !Number.isSafeInteger(total) || total <= 0 || !Number.isSafeInteger(paid.amountCents) || paid.amountCents <= 0 ||
      paid.amountCents !== total || paid.currency !== "usd" || owner.row.currency !== "usd" ||
      (provider === "terminal" && paid.providerPaymentId !== paid.providerPaymentIntentId)) return fail("conflict", "paid_identity_conflict");
  budget.reserve(4 + 3507);
  const [byIntent, byProviderId, ownership] = await Promise.all([
    paidIdentityForIntent(ctx, paid.providerPaymentIntentId), paidIdentityForProviderPayment(ctx, provider, paid.providerPaymentId),
    checkIntentOwnership(ctx, paid.providerPaymentIntentId, row => row.provider === provider && ownerMatches(row, owner) && row.providerPaymentId === paid.providerPaymentId)
  ]);
  if (byIntent.kind === "duplicate" || byProviderId.kind === "duplicate") return fail("conflict", "paid_identity_duplicate");
  if (byIntent.kind !== "one" || byProviderId.kind !== "one" || !samePaidRecord(byIntent.row, byProviderId.row, { providerPaymentId: paid.providerPaymentId, providerPaymentIntentId: paid.providerPaymentIntentId, amountCents: paid.amountCents, currency: paid.currency }) || byIntent.row._id !== paid._id) return fail("conflict", "paid_identity_conflict");
  if (ownership.kind === "conflict") return fail("conflict", "intent_ownership_conflict");
  if (ownership.kind === "unverified") { ownershipCoverage = "capped"; return fail("unverified", "intent_ownership_capped"); }
  ownershipCoverage = "complete";
  money.proof = "proven"; money.provenPaidCents = paid.amountCents; money.currency = "usd";
  return { money, coverage, ownershipCoverage, paid };
}
async function readRefunds(ctx: QueryCtx, owner: Owner | null, paid: Doc<"paymentEvents"> | null, budget: ReadBudget) {
  const reasons: IssueList = [];
  const refunds: Mutable<BillingDetail["refunds"]> = { proof: "unverified", reasons, succeededRefundCents: null, disposition: "unknown" };
  const fail = (proof: "unverified" | "conflict", reason: BillingIssueCode, coverage: BillingCoverage = "unverified") => { refunds.proof = proof; issue(reasons, reason); return { refunds, coverage, verifiedIds: null }; };
  if (!owner || !paid?.providerPaymentIntentId) return fail("unverified", "refund_proof_unverified", owner ? "unverified" : "not_applicable");
  budget.reserve(101);
  const rows = await ctx.db.query("refunds").withIndex("by_providerPaymentIntentId_status", q => q.eq("providerPaymentIntentId", paid.providerPaymentIntentId!).eq("status", "succeeded")).take(101);
  if (rows.length > 100) return fail("unverified", "refund_history_capped", "capped");
  const seen = new Set<string>(); let total = 0;
  for (const row of rows) {
    if (!row.providerRefundId || seen.has(row.providerRefundId)) return fail("conflict", "refund_identity_duplicate");
    seen.add(row.providerRefundId);
    if (row.providerPaymentIntentId !== paid.providerPaymentIntentId || row.paymentProvider !== paid.provider || !ownerMatches(row, owner) || row.currency !== paid.currency) return fail("conflict", "refund_owner_conflict");
    if (!Number.isSafeInteger(row.amountCents) || row.amountCents <= 0) return fail("conflict", "refund_amount_invalid");
    budget.reserve(2);
    const global = await ctx.db.query("refunds").withIndex("by_providerRefundId", q => q.eq("providerRefundId", row.providerRefundId)).take(2);
    if (global.length !== 1 || global[0]._id !== row._id) return fail("conflict", "refund_identity_duplicate");
    total += row.amountCents;
    if (!Number.isSafeInteger(total)) return fail("conflict", "refund_sum_overflow");
    if (total > paid.amountCents) return fail("conflict", "refund_exceeds_payment");
  }
  refunds.proof = "proven"; refunds.succeededRefundCents = total;
  refunds.disposition = total === 0 ? "none_succeeded_recorded" : total === paid.amountCents ? "full" : "partial";
  return { refunds, coverage: "complete" as const, verifiedIds: seen as ReadonlySet<string> };
}

const bookingReasonMap: Readonly<Record<string, BillingIssueCode>> = {
  "payment provenance needs reconciliation": "booking_payment_provenance_unverified",
  "payment is not confirmed": "booking_payment_not_confirmed",
  "stored money needs reconciliation": "booking_stored_money_unverified",
  "payment evidence needs reconciliation": "booking_payment_evidence_unverified",
  "billing needs staff review": "booking_billing_blocked",
  "ticket quantities or prices need reconciliation": "booking_line_provenance_unverified",
  "party count needs reconciliation": "booking_party_unverified",
  "stored total needs reconciliation": "booking_total_unverified",
  "settled payment needs reconciliation": "booking_settlement_unverified",
  "payment identity needs reconciliation": "booking_identity_unverified",
  "refund evidence needs reconciliation": "booking_refund_unverified",
  "payment was fully refunded": "booking_fully_refunded",
  "visit date needs reconciliation": "booking_visit_unverified",
  "entry time needs reconciliation": "booking_entry_unverified"
};
function showsUse(booking: Doc<"bookings">) {
  return booking.status === "checked-in" || booking.checkedInAt !== undefined || booking.departedAt !== undefined ||
    (booking.admissionTracked !== undefined && (booking.admissionTracked as unknown) !== false) || booking.admittedPartySize !== undefined || booking.departedPartySize !== undefined;
}
function emptyAttendance(): BillingDetail["attendance"] {
  return { used: null, admitted: null, departed: null, inside: null, proof: "unverified", reasons: ["admission_relation_unverified"] };
}
function deliveryProjection(row: Doc<"ticketDeliveries"> | null, correlated: boolean, applicable: boolean | null): BillingDelivery {
  if (!row) return { issuance: applicable === false ? "not_applicable" : applicable === true && correlated ? "not_found" : "unverified",
    status: null, acceptance: applicable === false ? "none_recorded" : "unverified", deliveryEvidence: applicable === false ? "none_recorded" : "unverified",
    sentAt: null, deliveredAt: null, providerDeliveryStatus: null, providerStatusAt: null, sendVersion: null, attemptCount: null, safeFailureReasonCode: null };
  const issues: IssueList = [];
  const status = known("deliveryStates", row.status, issues);
  const sendVersion = integer(row.sendVersion, issues, "invalid_counter", 1);
  const attemptCount = integer(row.attemptCount, issues, "invalid_counter");
  const sentAt = integer(row.sentAt, issues, "invalid_timestamp");
  const deliveredAt = integer(row.deliveredAt, issues, "invalid_timestamp");
  const providerStatusAt = integer(row.providerStatusAt, issues, "invalid_timestamp");
  const providerDeliveryStatus = known("emailProviderStates", row.providerDeliveryStatus, issues);
  const accepted = correlated && (status === "sent" || status === "suppressed") && sentAt !== null && sendVersion !== null && attemptCount !== null && attemptCount > 0 &&
    typeof row.providerMessageId === "string" && row.providerMessageId.length > 0 && row.providerMessageId.length <= 200 && !/[\u0000-\u001f\u007f]/.test(row.providerMessageId) && (row.lastAttemptAt === undefined || (Number.isSafeInteger(row.lastAttemptAt) && row.lastAttemptAt <= sentAt));
  const tracked = accepted && deliveredAt !== null && deliveredAt >= sentAt! && providerStatusAt !== null && providerStatusAt >= deliveredAt;
  return { issuance: correlated ? "issued" : "unverified", status,
    acceptance: accepted ? "recorded" : correlated && row.sentAt === undefined && row.providerMessageId === undefined ? "none_recorded" : "unverified",
    deliveryEvidence: tracked ? "recorded" : correlated && row.deliveredAt === undefined ? "none_recorded" : "unverified",
    sentAt, deliveredAt, providerDeliveryStatus, providerStatusAt, sendVersion, attemptCount, safeFailureReasonCode: safeReason(row.failureReason, issues) };
}
function recoveryProjection(kind: BillingRecovery["kind"], raw: Raw, correlated: boolean, retrievedAt: number): BillingRecovery {
  const issues: IssueList = correlated ? [] : ["recovery_identity_conflict"];
  const email = kind === "email_send" || kind === "email_tracking";
  const nextDueAt = integer(kind === "email_send" ? raw.autoRetryAt : kind === "email_tracking" ? raw.providerTrackingAt : raw.reconcileAt, issues, "invalid_timestamp");
  const leaseExpiresAt = integer(kind === "email_send" && raw.status === "sending" && typeof raw.lastAttemptAt === "number" ? raw.lastAttemptAt + 300000 : kind === "email_tracking" ? raw.providerTrackingLeaseExpiresAt : email ? undefined : raw.leaseExpiresAt, issues, "invalid_timestamp");
  const readerLeaseExpiresAt = integer(kind === "terminal" ? raw.readerProcessLeaseExpiresAt : undefined, issues, "invalid_timestamp");
  const state = known(kind === "checkout" ? "checkoutAttemptStates" : kind === "terminal" ? "terminalAttemptStates" : "deliveryStates", raw.status, issues);
  const providerState = known(kind === "checkout" ? "checkoutProviderStates" : kind === "terminal" ? "terminalProviderStates" : "emailProviderStates", email ? raw.providerDeliveryStatus : raw.lastProviderState, issues);
  const safeStopReasonCode = safeReason(email ? raw.failureReason : raw.exceptionReason, issues);
  const safeLastErrorCode = safeReason(raw.lastError, issues);
  const projected = { kind, state, correlation: correlated ? "correlated" as const : "unverified" as const, reasons: issues,
    mode: known("modes", email ? undefined : raw.stripeMode, issues), apiVersion: known("apiVersions", email ? undefined : raw.apiVersion, issues, "unrecognized_api_version"),
    providerState, safeStopReasonCode, lastErrorRecorded: raw.lastError !== undefined, safeLastErrorCode,
    providerRequestCount: integer(raw.providerRequestCount, issues, "invalid_counter"), reconcileCount: integer(raw.reconcileCount, issues, "invalid_counter"),
    readerProcessCount: integer(kind === "terminal" ? raw.readerProcessCount : undefined, issues, "invalid_counter"),
    autoRetryCount: integer(kind === "email_send" ? raw.autoRetryCount : undefined, issues, "invalid_counter"),
    trackingCount: integer(kind === "email_tracking" ? raw.providerTrackingCount : undefined, issues, "invalid_counter"),
    firstProviderRequestAt: integer(raw.firstProviderRequestAt, issues, "invalid_timestamp"), lastProviderRequestAt: integer(raw.lastProviderRequestAt, issues, "invalid_timestamp"),
    lastReconciliationAttemptAt: integer(raw.lastReconciledAt, issues, "invalid_timestamp"),
    lastReaderProcessAt: integer(kind === "terminal" ? raw.lastReaderProcessAt : undefined, issues, "invalid_timestamp"),
    lastEmailAttemptAt: integer(email ? raw.lastAttemptAt : undefined, issues, "invalid_timestamp"), settledAt: integer(raw.settledAt, issues, "invalid_timestamp"),
    nextDueAt, leaseExpiresAt, readerLeaseExpiresAt };
  const schedule: BillingRecovery["schedule"] = !correlated || issues.some(code => code === "invalid_timestamp" || code === "invalid_counter" || code === "unrecognized_state" || code === "unrecognized_api_version") ? "unverified"
    : (leaseExpiresAt ?? 0) > retrievedAt || (readerLeaseExpiresAt ?? 0) > retrievedAt ? "active_lease"
      : nextDueAt !== null ? "scheduled" : safeStopReasonCode !== null ? "stopped" : "none_recorded";
  return { ...projected, schedule };
}
function object(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
type WebhookIds = { family: "checkout" | "terminal" | "refund"; session: string | null; intent: string | null; refund: string | null };
function providerId(value: unknown): string | null {
  return typeof value === "string" && !!value && value.trim() === value && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
}
/** Writer-family identities only; an unrelated raw object can never lend an ID. */
function webhookIds(exception: Doc<"operationsExceptions">, record: Doc<"webhookEvents">): WebhookIds | null {
  const raw = object(record.raw); if (!raw || raw.eventId !== exception.providerEventId || raw.eventType !== record.eventType) return null;
  if (["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired"].includes(record.eventType)) {
    const session = object(raw.session); const id = providerId(session?.id); const intent = providerId(session?.payment_intent);
    if (!id || (session?.payment_intent !== undefined && intent === null)) return null;
    return { family: "checkout", session: id, intent, refund: null };
  }
  if (["payment_intent.succeeded", "payment_intent.payment_failed", "payment_intent.canceled"].includes(record.eventType)) {
    const id = providerId(object(raw.paymentIntent)?.id); return id ? { family: "terminal", session: null, intent: id, refund: null } : null;
  }
  if (["refund.created", "refund.updated", "refund.failed"].includes(record.eventType)) {
    const refund = object(raw.refund); const id = providerId(refund?.id), intent = providerId(refund?.payment_intent);
    return id && intent ? { family: "refund", session: null, intent, refund: id } : null;
  }
  return null;
}
function webhookIdentityMatches(exception: Doc<"operationsExceptions">, ids: WebhookIds | null) {
  if (!ids) return false;
  return (exception.providerSessionId === undefined || ids.session === exception.providerSessionId) &&
    (exception.providerPaymentIntentId === undefined || ids.intent === exception.providerPaymentIntentId) &&
    (exception.evidence?.providerRefundId === undefined || ids.refund === exception.evidence.providerRefundId);
}
function webhookSupportsRecovery(ids: WebhookIds | null, channel: "order" | "sale", session: string | undefined, intent: string | undefined, refundIds: ReadonlySet<string> | null) {
  if (!ids) return false;
  if (ids.family === "refund") return !!intent && ids.intent === intent && ids.refund !== null && !!refundIds?.has(ids.refund);
  if (channel === "order") return ids.family === "checkout" && !!session && ids.session === session && (ids.intent === null || ids.intent === intent);
  return ids.family === "terminal" && !!intent && ids.intent === intent;
}
function webhookProvider(exception: Doc<"operationsExceptions">): "stripe" | "terminal" | null {
  const code = isBillingVocabularyValue("exceptionCodes", exception.code) ? exception.code : null;
  const event = isBillingVocabularyValue("eventTypes", exception.evidence?.eventType) ? exception.evidence!.eventType : null;
  if (event === "refund.created" || event === "refund.updated" || event === "refund.failed" || (code && vocab.exceptionCodes.filter(value => value.startsWith("refund_")).includes(code as never))) return "stripe";
  if (event === "checkout.session.completed" || event === "checkout.session.async_payment_succeeded" || event === "checkout.session.async_payment_failed" || event === "checkout.session.expired") return "stripe";
  if (event === "payment_intent.succeeded" || event === "payment_intent.payment_failed" || event === "payment_intent.canceled") return "terminal";
  return null;
}

/** Protected read only. Every query is bounded; helpers are invoked at most once per domain. */
export async function readBillingDetail(ctx: QueryCtx, exception: Doc<"operationsExceptions">, role: BillingRole, retrievedAt: number): Promise<BillingDetail> {
  const budget = new ReadBudget(); budget.reserve(3); // staff2 and exact selected exception1
  const relationReasons: IssueList = [];
  const orderRef = internalRef(exception.orderRef); const saleRef = internalRef(exception.saleRef);
  const relation: Mutable<BillingDetail["relation"]> = { state: "unverified", reasons: relationReasons };
  let owner: Owner | null = null;
  if ((exception.orderRef !== undefined) === (exception.saleRef !== undefined) || (!orderRef && !saleRef)) issue(relationReasons, "owner_ref_conflict");
  else {
    budget.reserve(2);
    const rows = orderRef
      ? await ctx.db.query("orders").withIndex("by_orderRef", q => q.eq("orderRef", orderRef)).take(2)
      : await ctx.db.query("posSales").withIndex("by_saleRef", q => q.eq("saleRef", saleRef!)).take(2);
    if (rows.length > 1) { relation.state = "ambiguous"; issue(relationReasons, "owner_ambiguous"); }
    else if (!rows[0]) { relation.state = "missing"; issue(relationReasons, "owner_missing"); }
    else {
      owner = { kind: orderRef ? "order" : "sale", ref: orderRef ?? saleRef!, row: rows[0] };
      relation.state = isBillingDisplayRef(owner.ref) ? "correlated" : "unverified";
      if (relation.state !== "correlated") issue(relationReasons, "invalid_ref");
    }
  }
  let lines: Array<Doc<"orderLineItems"> | Doc<"posSaleLines">> = [];
  let ownerBookings: Doc<"bookings">[] = []; let ownerDeliveries: Doc<"ticketDeliveries">[] = [];
  let attempts: Array<Doc<"checkoutPaymentAttempts"> | Doc<"terminalPaymentAttempts">> = [];
  if (owner) {
    budget.reserve(101 + 2 + 2 + 2);
    [lines, ownerBookings, ownerDeliveries, attempts] = owner.kind === "order"
      ? await Promise.all([
        ctx.db.query("orderLineItems").withIndex("by_orderRef", q => q.eq("orderRef", owner!.ref)).take(101),
        ctx.db.query("bookings").withIndex("by_orderRef", q => q.eq("orderRef", owner!.ref)).take(2),
        ctx.db.query("ticketDeliveries").withIndex("by_orderRef", q => q.eq("orderRef", owner!.ref)).take(2),
        ctx.db.query("checkoutPaymentAttempts").withIndex("by_orderRef", q => q.eq("orderRef", owner!.ref)).take(2)
      ]) : await Promise.all([
        ctx.db.query("posSaleLines").withIndex("by_saleRef", q => q.eq("saleRef", owner!.ref)).take(101),
        ctx.db.query("bookings").withIndex("by_saleRef", q => q.eq("saleRef", owner!.ref)).take(2),
        ctx.db.query("ticketDeliveries").withIndex("by_saleRef", q => q.eq("saleRef", owner!.ref)).take(2),
        ctx.db.query("terminalPaymentAttempts").withIndex("by_saleRef", q => q.eq("saleRef", owner!.ref)).take(2)
      ]);
  }
  const projectedLines = lines.slice(0, 100).map(projectBillingLine);
  let lineCoverage: BillingCoverage = !owner ? "not_applicable" : lines.length > 100 ? "capped" : projectedLines.some(line => line.dataIssues.length) || !lines.length ? "unverified" : "complete";
  if (owner && lineCoverage === "complete") {
    let sum = 0;
    for (const line of lines) { sum += line.lineTotalCents; if (!Number.isSafeInteger(sum)) { lineCoverage = "unverified"; break; } }
    if (sum !== owner.row.subtotalCents) lineCoverage = "unverified";
  }
  const totalParty = lines.filter(line => line.kind === "ticket").reduce((sum, line) => sum + line.quantity, 0);
  if (lines.some(line => line.kind === "ticket") && (!Number.isSafeInteger(totalParty) || totalParty < 1 || totalParty > 30)) lineCoverage = "unverified";
  const applicable = lineCoverage === "complete" ? lines.some(line => line.kind === "ticket") : null;
  const candidateRefs = [...new Set([...ownerBookings.map(row => internalRef(row.bookingRef)), ...ownerDeliveries.map(row => internalRef(row.bookingRef)), internalRef(exception.bookingRef)].filter((ref): ref is string => ref !== null))];
  if (candidateRefs.length > 5) billingReadFailure("billing_read_unverified");
  budget.reserve(candidateRefs.length * 4);
  const [globalBookings, admissionLookups] = await Promise.all([
    Promise.all(candidateRefs.map(ref => ctx.db.query("bookings").withIndex("by_bookingRef", q => q.eq("bookingRef", ref)).take(2))),
    Promise.all(candidateRefs.map(ref => lookupBookingAdmission(ctx, ref)))
  ]);
  const allBookings = [...new Map([...ownerBookings, ...globalBookings.flat()].map(row => [row._id, row])).values()];
  const candidate = ownerBookings.length === 1 ? ownerBookings[0] : null;
  const chosenGlobal = candidate ? globalBookings[candidateRefs.indexOf(candidate.bookingRef)] : undefined;
  const bookingConsistent = !!owner && relation.state === "correlated" && candidate !== null && ownerMatches(candidate, owner) && isBillingDisplayRef(candidate.bookingRef) &&
    candidateRefs.length === 1 && chosenGlobal?.length === 1 && chosenGlobal[0]._id === candidate._id &&
    (exception.bookingRef === undefined || exception.bookingRef === candidate.bookingRef) && allBookings.length === 1;
  const bookingReasons: IssueList = [];
  let booking: BillingDetail["booking"] = null;
  const moneyState = await readMoney(ctx, owner, relation, budget);
  const refundState = await readRefunds(ctx, owner, moneyState.paid, budget);
  if (candidate) {
    const dtoIssues: IssueList = [];
    const bookingRef = displayRef(candidate.bookingRef, dtoIssues);
    const visitDate = date(candidate.visitDate, dtoIssues); const entryTime = time(candidate.entryTime, dtoIssues);
    const partySize = integer(candidate.partySize, dtoIssues, "invalid_party_size", 1, 30);
    const state = known("bookingStates", candidate.status, dtoIssues);
    const bookingRefs = refs(candidate, dtoIssues);
    const cancelledAt = integer(candidate.cancelledAt, dtoIssues, "invalid_timestamp");
    let paidProof: "proven" | "blocked" | "unverified" = "unverified";
    if (!bookingConsistent) issue(bookingReasons, "booking_ref_conflict");
    else if (!visitDate || !entryTime || partySize === null || state === null || dtoIssues.length) issue(bookingReasons, "booking_payment_provenance_unverified");
    else if (moneyState.money.proof !== "proven" || refundState.refunds.proof !== "proven") issue(bookingReasons, "booking_refund_unverified");
    else {
      budget.reserve(3817);
      const proof = await bookingPaidProof(ctx, candidate);
      if (proof.ok) paidProof = "proven";
      else { paidProof = "blocked"; issue(bookingReasons, bookingReasonMap[proof.reason] ?? "booking_payment_provenance_unverified"); }
    }
    for (const code of dtoIssues) issue(bookingReasons, code);
    booking = { bookingRef, refs: bookingRefs, status: state, visitDate, entryTime, partySize, cancelledAt, paidProof, reasons: bookingReasons };
  }
  let attendance: BillingDetail["attendance"] = emptyAttendance();
  const used = allBookings.some(showsUse) || admissionLookups.some(lookup => lookup.kind !== "none");
  if (used) attendance = { used: true, admitted: null, departed: null, inside: null, proof: "unverified", reasons: ["admission_relation_unverified"] };
  if (bookingConsistent && candidate) {
    const lookup = admissionLookups[candidateRefs.indexOf(candidate.bookingRef)];
    if (lookup?.kind === "one") {
      const admission = lookup.admission;
      try {
        const inside = remainingAdmissionParty(admission);
        if (!parseVisitDate(admission.visitDate) || admission.visitDate !== candidate.visitDate || admission.partySize !== candidate.partySize ||
            !Number.isSafeInteger(admission.admittedAt) || admission.admittedAt < 0 || (!inside && admission.departedAt === undefined) ||
            (admission.departedAt !== undefined && (!Number.isSafeInteger(admission.departedAt) || admission.departedAt < admission.admittedAt))) throw new Error("invalid");
        attendance = { used: true, admitted: admission.partySize, departed: admission.departedCount, inside, proof: "proven", reasons: [] };
      } catch { attendance = { used: true, admitted: null, departed: null, inside: null, proof: "unverified", reasons: ["admission_counts_invalid"] }; }
    } else if (lookup?.kind === "duplicate") attendance = { used: true, admitted: null, departed: null, inside: null, proof: "unverified", reasons: ["admission_duplicate"] };
    else if (showsUse(candidate)) attendance = { used: true, admitted: null, departed: null, inside: null, proof: "unverified", reasons: ["legacy_use_recorded"] };
    else if (!used && (candidate.status === "confirmed" || candidate.status === "cancelled")) attendance = { used: false, admitted: null, departed: null, inside: null, proof: "proven", reasons: [] };
  } else if (applicable === false && !used && !candidateRefs.length && owner && relation.state === "correlated") {
    attendance = { used: null, admitted: null, departed: null, inside: null, proof: "not_applicable", reasons: [] };
  }
  let bookingDeliveries: Doc<"ticketDeliveries">[] = [];
  if (bookingConsistent && candidate) {
    budget.reserve(2); bookingDeliveries = await ctx.db.query("ticketDeliveries").withIndex("by_bookingRef", q => q.eq("bookingRef", candidate.bookingRef)).take(2);
  }
  const delivery = ownerDeliveries.length === 1 ? ownerDeliveries[0] : null;
  const deliveryConsistent = !!delivery && !!owner && bookingConsistent && candidate !== null && ownerMatches(delivery, owner) &&
    delivery.bookingRef === candidate.bookingRef && bookingDeliveries.length === 1 && bookingDeliveries[0]._id === delivery._id;
  const deliveryAbsentCorrelated = bookingConsistent && ownerDeliveries.length === 0 && bookingDeliveries.length === 0;
  const projectedDelivery = deliveryProjection(delivery, deliveryConsistent || deliveryAbsentCorrelated, relation.state === "correlated" ? applicable : null);
  let webhookCoverage: BillingCoverage = exception.providerEventId === undefined ? "not_applicable" : "unverified";
  const provider = webhookProvider(exception);
  let selectedWebhookIds: WebhookIds | null = null;
  if (exception.providerEventId && provider) {
    budget.reserve(2);
    const records = await ctx.db.query("webhookEvents").withIndex("by_provider_providerEventId", q => q.eq("provider", provider).eq("providerEventId", exception.providerEventId!)).take(2);
    const record = records[0];
    if (records.length === 1 && record.providerEventId === exception.providerEventId && record.provider === provider &&
        isBillingVocabularyValue("eventTypes", record.eventType) && (!exception.evidence?.eventType || record.eventType === exception.evidence.eventType) &&
        record.orderRef === exception.orderRef && record.saleRef === exception.saleRef && webhookIdentityMatches(exception, webhookIds(exception, record))) {
      webhookCoverage = "complete"; selectedWebhookIds = webhookIds(exception, record);
    }
  }
  const attempt = attempts.length === 1 ? attempts[0] : null;
  const attemptCorrelated = !!attempt && !!owner && relation.state === "correlated" &&
    (owner.kind === "order" ? "orderRef" in attempt && attempt.orderRef === owner.ref : "saleRef" in attempt && attempt.saleRef === owner.ref) &&
    (exception.providerPaymentIntentId === undefined || exception.providerPaymentIntentId === attempt.providerPaymentIntentId) &&
    (exception.providerSessionId === undefined || ("providerSessionId" in attempt && exception.providerSessionId === attempt.providerSessionId)) &&
    (exception.providerEventId === undefined || (webhookCoverage === "complete" && webhookSupportsRecovery(selectedWebhookIds, owner.kind,
      "providerSessionId" in attempt ? attempt.providerSessionId : undefined, attempt.providerPaymentIntentId, refundState.verifiedIds)));
  const emailCorrelated = deliveryConsistent &&
    (exception.providerPaymentIntentId === undefined || exception.providerPaymentIntentId === moneyState.paid?.providerPaymentIntentId) &&
    (exception.providerSessionId === undefined || exception.providerSessionId === moneyState.paid?.providerPaymentId) &&
    (exception.providerEventId === undefined || (webhookCoverage === "complete" && !!owner && webhookSupportsRecovery(selectedWebhookIds, owner.kind,
      owner.kind === "order" ? moneyState.paid?.providerPaymentId : undefined, moneyState.paid?.providerPaymentIntentId, refundState.verifiedIds)));
  const recovery: BillingRecovery[] = [];
  if (attempt && owner) recovery.push(recoveryProjection(owner.kind === "order" ? "checkout" : "terminal", attempt as Raw, attemptCorrelated, retrievedAt));
  if (delivery) {
    recovery.push(recoveryProjection("email_send", delivery as Raw, emailCorrelated, retrievedAt));
    recovery.push(recoveryProjection("email_tracking", delivery as Raw, emailCorrelated, retrievedAt));
  }
  const auditType = owner ? owner.kind === "order" ? "order" as const : "posSale" as const : "operationsException" as const;
  const auditRef = owner?.ref ?? exception.dedupeKey;
  budget.reserve(26 + (owner ? 22 : 0));
  const [payments, refunds, audit] = await Promise.all([
    owner ? owner.kind === "order" ? ctx.db.query("paymentEvents").withIndex("by_orderRef", q => q.eq("orderRef", owner!.ref)).order("desc").take(11) : ctx.db.query("paymentEvents").withIndex("by_saleRef", q => q.eq("saleRef", owner!.ref)).order("desc").take(11) : Promise.resolve([]),
    owner ? owner.kind === "order" ? ctx.db.query("refunds").withIndex("by_orderRef_updatedAt", q => q.eq("orderRef", owner!.ref)).order("desc").take(11) : ctx.db.query("refunds").withIndex("by_saleRef_updatedAt", q => q.eq("saleRef", owner!.ref)).order("desc").take(11) : Promise.resolve([]),
    ctx.db.query("auditEvents").withIndex("by_entity", q => q.eq("entityType", auditType).eq("entityRef", auditRef)).order("desc").take(26)
  ]);
  const exceptionDTO = projectBillingException(exception);
  const evidenceIssues: IssueList = [...exceptionDTO.dataIssues];
  const evidence = projectEvidence(exception, evidenceIssues);
  const result: BillingDetail = { version: 1, role, lookup: { exceptionId: exception._id }, retrievedAt,
    exception: { ...exceptionDTO, dataIssues: evidenceIssues }, evidence, relation, owner: owner ? projectOwner(owner) : null,
    lines: { coverage: lineCoverage, rows: projectedLines }, money: moneyState.money, refunds: refundState.refunds, booking, attendance,
    delivery: projectedDelivery, recovery,
    recent: {
      payments: { coverage: !owner ? "not_applicable" : payments.length > 10 ? "capped" : "complete", limit: 10, order: "native_creation_desc", rows: payments.slice(0, 10).map(projectPayment) },
      refunds: { coverage: !owner ? "not_applicable" : refunds.length > 10 ? "capped" : "complete", limit: 10, order: "recorded_updatedAt_desc", rows: refunds.slice(0, 10).map(projectRefund) },
      audit: { coverage: audit.length > 25 ? "capped" : "complete", limit: 25, order: "native_creation_desc", rows: audit.slice(0, 25).map(row => projectAudit(row, auditType)), scope: owner ? "owner" : "exception_series" }
    },
    coverage: { owner: relation.state === "correlated" ? "complete" : "unverified", lines: lineCoverage,
      paid: moneyState.coverage, intentOwnership: moneyState.ownershipCoverage, refunds: refundState.coverage,
      booking: bookingConsistent ? "complete" : applicable === false && !ownerBookings.length ? "not_applicable" : "unverified",
      admission: attendance.proof === "proven" ? "complete" : attendance.proof === "not_applicable" ? "not_applicable" : "unverified",
      delivery: deliveryConsistent || deliveryAbsentCorrelated ? "complete" : projectedDelivery.issuance === "not_applicable" ? "not_applicable" : "unverified",
      attempt: attemptCorrelated ? "complete" : !attempts.length ? "not_applicable" : "unverified", webhook: webhookCoverage }
  };
  assertBillingOutput(result); return result;
}

type PageContext = Pick<BillingPageRequest, "status" | "limit">;
type BillingCursor = { namespace: "billing-exceptions"; version: 1; direction: "desc"; status: BillingPageRequest["status"]; limit: number; cutoff: number; native: string };
export const billingCursorMaximum = 8192;
export function encodeBillingCursor(context: PageContext, cutoff: number, native: string) {
  if (typeof native !== "string" || !native || /[\u0000-\u001f\u007f]/.test(native)) billingReadFailure("billing_read_unverified");
  const value: BillingCursor = { namespace: "billing-exceptions", version: 1, direction: "desc", ...context, cutoff, native };
  const encoded = `bex1.${encodeURIComponent(JSON.stringify(value))}`;
  if (encoded.length > billingCursorMaximum) billingReadFailure("billing_read_unverified");
  return encoded;
}
export function decodeBillingCursor(encoded: string, context: PageContext, now: number): BillingCursor {
  try {
    if (!encoded.startsWith("bex1.") || encoded.length > billingCursorMaximum || /[\u0000-\u001f\u007f]/.test(encoded)) throw new Error();
    const value: unknown = JSON.parse(decodeURIComponent(encoded.slice(5)));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const data = value as BillingCursor;
    if (Object.keys(data).sort().join(",") !== "cutoff,direction,limit,namespace,native,status,version" || data.namespace !== "billing-exceptions" || data.version !== 1 || data.direction !== "desc" ||
        data.status !== context.status || data.limit !== context.limit || !Number.isSafeInteger(data.cutoff) || data.cutoff < 0 || data.cutoff > now ||
        typeof data.native !== "string" || !data.native || /[\u0000-\u001f\u007f]/.test(data.native)) throw new Error();
    return data;
  } catch { return billingReadFailure("billing_cursor_invalid"); }
}
