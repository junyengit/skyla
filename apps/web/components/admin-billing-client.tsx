"use client";

import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState, type Ref } from "react";
import type {
  BillingDetail, BillingException, BillingExceptionStatus, BillingHttpErrorCode, BillingRecovery, BillingRole
} from "@skyla/payments";
import { useStaffSession } from "@/components/staff-auth-provider";
import {
  normalizeBillingDetailRequest, normalizeBillingPageRequest, parseBillingDetail, parseBillingExceptionPage
} from "@/lib/billing-contract";
import { readBillingBatch, startBillingTraversal, type BillingTraversal } from "@/lib/billing-traversal";

const amount = (cents: number | null, currency: "usd" | null) => cents === null || currency !== "usd" ? "Not verified" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const localTime = (value: number | null | undefined) => {
  if (value == null) return "Not recorded";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date not verified";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
};
/** Inputs have already passed the strict finite shared vocabulary, never raw stored text. */
const words = (code: string | null, fallback = "Not verified") => code === null ? fallback : code.replaceAll("_", " ").replaceAll(".", " · ").replace(/([a-z])([A-Z])/g, "$1 $2");
const exceptionLabel = (row: BillingException) => words(row.code, "Unrecognized recorded exception");
const reference = (row: BillingException) => row.refs.orderRef && row.refs.saleRef ? `Conflicting business references: ${row.refs.orderRef} / ${row.refs.saleRef}` : row.refs.orderRef ?? row.refs.saleRef ?? row.refs.bookingRef ?? "No verified business reference";
const issueText = (reasons: readonly string[]) => reasons.length ? reasons.map(reason => words(reason)).join("; ") : "No additional reason recorded";
const coverageText = { complete: "This local recorded source is fully loaded.", capped: "Only the recent recorded prefix is shown; more records exist.", unverified: "This recorded source could not be verified.", not_applicable: "No applicable recorded source." };
const proofText = { proven: "Proven identity match", none_recorded: "No matching recorded fact", unverified: "Not verified", conflict: "Conflicting evidence" };

function RecoveryRead({ recovery }: { recovery: BillingRecovery }) {
  const kind = { checkout: "Online payment", terminal: "Card reader payment", email_send: "Confirmation email", email_tracking: "Email delivery tracking" }[recovery.kind];
  const payment = recovery.kind === "checkout" || recovery.kind === "terminal";
  return <div className="billingRecoveryRecord">
    <p><strong>{kind}</strong> · {recovery.correlation === "correlated" ? "Correlated recorded recovery" : "Recovery identity not verified"}</p>
    <dl className="billingFacts">
      <div><dt>Recorded state</dt><dd>{words(recovery.state)}</dd></div>
      {payment && <div><dt>Recorded mode / API version</dt><dd>{recovery.mode ?? "Not verified"} / {recovery.apiVersion ?? "Not verified"}</dd></div>}
      <div><dt>Recorded provider state</dt><dd>{words(recovery.providerState)}</dd></div>
      <div><dt>Recorded schedule</dt><dd>{recovery.schedule === "scheduled" ? "Due time recorded" : recovery.schedule === "active_lease" ? "Current claim recorded" : recovery.schedule === "stopped" ? recovery.safeStopReasonCode ? `No safe retry is scheduled: ${words(recovery.safeStopReasonCode)}.` : "No safe retry is scheduled; reason not recorded." : recovery.schedule === "none_recorded" ? "No due time recorded" : "Scheduling evidence not verified"}</dd></div>
      <div><dt>Next recorded due time</dt><dd>{localTime(recovery.nextDueAt)}</dd></div>
      {payment && <>
        <div><dt>Last reconciliation attempt</dt><dd>{localTime(recovery.lastReconciliationAttemptAt)}</dd></div>
        <div><dt>Provider requests / reconciliation attempts</dt><dd>{recovery.providerRequestCount ?? "Not verified"} / {recovery.reconcileCount ?? "Not verified"}</dd></div>
      </>}
      {recovery.kind === "terminal" && <>
        <div><dt>Reader process attempts</dt><dd>{recovery.readerProcessCount ?? "Not verified"}</dd></div>
        <div><dt>Last reader process attempt</dt><dd>{localTime(recovery.lastReaderProcessAt)}</dd></div>
      </>}
      {!payment && <div><dt>Last email attempt</dt><dd>{localTime(recovery.lastEmailAttemptAt)}</dd></div>}
      {recovery.kind === "email_send" && <div><dt>Automatic retry attempts</dt><dd>{recovery.autoRetryCount ?? "Not verified"}</dd></div>}
      {recovery.kind === "email_tracking" && <div><dt>Tracking attempts</dt><dd>{recovery.trackingCount ?? "Not verified"}</dd></div>}
      {recovery.leaseExpiresAt !== null && <div><dt>Main claim expiry</dt><dd>{localTime(recovery.leaseExpiresAt)}</dd></div>}
      {recovery.kind === "terminal" && recovery.readerLeaseExpiresAt !== null && <div><dt>Reader claim expiry</dt><dd>{localTime(recovery.readerLeaseExpiresAt)}</dd></div>}
      {(recovery.lastErrorRecorded || recovery.safeLastErrorCode) && <div><dt>Recorded error</dt><dd>{recovery.safeLastErrorCode ? words(recovery.safeLastErrorCode) : "Error recorded; unsafe text withheld"}</dd></div>}
    </dl>
    {recovery.reasons.length > 0 && <p>Evidence limits: {issueText(recovery.reasons)}.</p>}
  </div>;
}

/** Pure actual presentation; SSR fixtures must label synthetic data and prove no authentication. */
export function BillingDetailView({ detail }: { detail: BillingDetail }) {
  const row = detail.exception;
  const admissionRelevant = detail.attendance.proof !== "not_applicable";
  const bookingRestriction = [
    detail.booking?.status === "cancelled" ? "Booking cancellation is recorded." : "",
    detail.booking?.paidProof === "blocked" ? "Admission payment proof is blocked."
      : detail.booking?.paidProof === "unverified" ? "Admission payment proof is unverified."
        : !detail.booking && admissionRelevant ? "Booking and admission payment proof are unverified." : ""
  ].filter(Boolean).join(" ");
  const useRestriction = detail.attendance.used === true
    ? detail.attendance.proof === "proven" ? "Admission use recorded. No re-entry, including after refund or departure."
      : "Use evidence found; its relation or counts are unverified. Do not assume unused."
    : detail.attendance.used === null && admissionRelevant ? "Admission use not verified. Do not assume unused." : "";
  return <div className="billingDetail">
    <h2>{exceptionLabel(row)}</h2>
    <p><strong>{reference(row)}</strong> · {row.status === "resolved" ? "Recorded resolved exception" : "Recorded open exception"}</p>
    <p>Read {localTime(detail.retrievedAt)}, Los Angeles time. Recorded evidence; no live provider check.</p>
    {bookingRestriction && <p>{bookingRestriction}</p>}
    {useRestriction && <p>{useRestriction}</p>}
    <p>Recorded origin: {detail.evidence.source ?? "Not recorded"} · Event {words(detail.evidence.eventType, "Not recorded")} · Mode {detail.evidence.mode ?? "Not verified"}.</p>
    <p>Masked provider references: Session {row.idsMasked.session ?? "Not recorded"} · Intent {row.idsMasked.paymentIntent ?? "Not recorded"} · Event {row.idsMasked.providerEvent ?? "Not recorded"} · Refund {row.idsMasked.providerRefund ?? "Not recorded"}. These displays are not identity proofs.</p>
    {row.status === "resolved" && <p>Resolution recorded {localTime(row.resolvedAt)}: {words(row.resolutionCode, row.resolutionRecorded ? "Reason recorded but not safely exposed" : "No reason recorded")}. This does not independently prove refund, delivery or healthy recovery.</p>}
    <p>Owner relation: {words(detail.relation.state)}. {detail.relation.reasons.length > 0 && issueText(detail.relation.reasons)}</p>
    <h3>Money and refunds</h3>
    <p>Recorded amounts and payment proof are separate. Missing facts do not prove no charge; local refund proof is not complete provider-account history.</p>
    <dl className="billingFacts">
      <div><dt>Recorded exception amount</dt><dd>{amount(row.amountCents, row.currency)}</dd></div>
      <div><dt>Exception received-money fact</dt><dd>{row.moneyReceived ? "Received money recorded" : "No affirmative received-money fact on this exception"}</dd></div>
      <div><dt>Stored purchase total</dt><dd>{detail.owner ? amount(detail.owner.totalCents, detail.owner.currency) : "Owner not verified"}</dd></div>
      <div><dt>Recorded paid fact</dt><dd>{detail.money.paidFactRecorded ? "Paid fact recorded independently of booking or proof failures" : "No paid fact recorded in this local evidence"}</dd></div>
      <div><dt>Exact payment proof</dt><dd>{proofText[detail.money.proof]}{detail.money.reasons.length > 0 && `: ${issueText(detail.money.reasons)}`}</dd></div>
      <div><dt>Proven paid amount</dt><dd>{amount(detail.money.provenPaidCents, detail.money.currency)}</dd></div>
      <div><dt>Proven succeeded refunds</dt><dd>{amount(detail.refunds.succeededRefundCents, detail.money.currency)} · {proofText[detail.refunds.proof]}</dd></div>
      <div><dt>Recorded refund disposition</dt><dd>{detail.refunds.disposition === "none_succeeded_recorded" ? "No succeeded refund in this proven local subset" : detail.refunds.disposition === "partial" ? "Partial succeeded refund in this proven local subset" : detail.refunds.disposition === "full" ? "Full succeeded refund in this proven local subset" : "Returned-money amount not verified"}</dd></div>
    </dl>
    {detail.refunds.reasons.length > 0 && <p>Refund evidence limits: {issueText(detail.refunds.reasons)}.</p>}
    {detail.owner && <p>Stored purchase state: {words(detail.owner.status)} · {detail.owner.channel === "online" ? "Online" : "POS"}.</p>}
    <p>{coverageText[detail.lines.coverage]} Historical line amounts are shown as recorded, without repricing.</p>
    <ul className="billingLineList">{detail.lines.rows.map(line => <li key={line.rowId}>
      <strong>{line.kind === "ticket" ? line.admissionCategory === "adult" ? "Adult admission" : line.admissionCategory === "youth" ? "Youth admission" : line.admissionCategory === "child" ? "Child admission" : "Admission category not verified" : words(line.kind, "Line kind not verified")}</strong>
      <span>Quantity {line.quantity ?? "not verified"} · Unit amount {amount(line.unitAmountCents, detail.owner?.currency ?? null)} · Recorded line total {amount(line.lineTotalCents, detail.owner?.currency ?? null)}</span>
      {line.dataIssues.length > 0 && <span>{issueText(line.dataIssues)}</span>}
    </li>)}</ul>
    <h3>Visit, use and confirmation delivery</h3>
    <p>Ticket issuance, admission use, email acceptance and tracking are independent. This desk grants no entry permission or current inbox proof. Later negative email status can coexist with earlier positive tracking.</p>
    <dl className="billingFacts">
      <div><dt>Booking</dt><dd>{detail.booking ? `${detail.booking.bookingRef ?? "Reference not verified"} · ${words(detail.booking.status)} · ${detail.booking.visitDate ?? "Date not verified"} · ${detail.booking.entryTime ?? "Time not verified"}, Los Angeles` : "No verified booking relation"}</dd></div>
      <div><dt>Admission payment proof</dt><dd>{detail.booking ? words(detail.booking.paidProof) : "Not applicable or unverified"}.</dd></div>
      <div><dt>Party size</dt><dd>{detail.booking?.partySize ?? "Not verified"}</dd></div>
      <div><dt>Recorded use</dt><dd>{detail.attendance.used === true ? detail.attendance.proof === "proven" ? "Used; complete verified relation" : "Use evidence found; relation not verified" : detail.attendance.used === false ? "No use recorded in the complete verified relation" : admissionRelevant ? "Not verified" : "Not applicable"}</dd></div>
      <div><dt>Admitted / departed / inside</dt><dd>{[detail.attendance.admitted, detail.attendance.departed, detail.attendance.inside].every(count => count === null) ? admissionRelevant ? "Counts not verified" : "Not applicable" : `${detail.attendance.admitted ?? "Not verified"} / ${detail.attendance.departed ?? "Not verified"} / ${detail.attendance.inside ?? "Not verified"}`}</dd></div>
      <div><dt>Ticket issuance</dt><dd>{detail.delivery.issuance === "issued" ? "Issued ticket record exists" : detail.delivery.issuance === "not_found" ? "No ticket record found in this exact source" : detail.delivery.issuance === "not_applicable" ? "Not applicable to this verified purchase" : "Ticket issuance not verified"}</dd></div>
      <div><dt>Email provider acceptance</dt><dd>{detail.delivery.acceptance === "recorded" ? `Recorded ${localTime(detail.delivery.sentAt)}` : detail.delivery.acceptance === "none_recorded" ? "No acceptance recorded" : "Acceptance not verified"}</dd></div>
      <div><dt>Positive delivery tracking</dt><dd>{detail.delivery.deliveryEvidence === "recorded" ? `Recorded ${localTime(detail.delivery.deliveredAt)}` : detail.delivery.deliveryEvidence === "none_recorded" ? "No positive tracking recorded" : "Tracking not verified"}</dd></div>
      <div><dt>Latest recorded email provider status</dt><dd>{words(detail.delivery.providerDeliveryStatus)} · {localTime(detail.delivery.providerStatusAt)}.</dd></div>
    </dl>
    {(detail.booking?.reasons.length || detail.attendance.reasons.length) ? <p>Visit evidence limits: {issueText([...(detail.booking?.reasons ?? []), ...detail.attendance.reasons])}.</p> : null}
    <h3>Recorded recovery</h3>
    <p>Scheduling and attempt records do not verify provider reads, worker health or payment outcomes.</p>
    {detail.recovery.length === 0 ? <p>No correlated recovery record shown.</p> : detail.recovery.map(recovery => <RecoveryRead key={recovery.kind} recovery={recovery} />)}
    <h3>Recent recorded history</h3>
    <div className="billingHistory">
      <div><h4>Payments</h4><p>{coverageText[detail.recent.payments.coverage]} Recorded creation order; these rows do not calculate payment proof or totals.</p>
        <ul>{detail.recent.payments.rows.map(payment => <li key={payment.rowId}><strong>{words(payment.status)}</strong> · {amount(payment.amountCents, payment.currency)} · {localTime(payment.recordedAt)}<span>Provider {words(payment.provider)} · Payment {payment.paymentIdMasked} · Intent {payment.intentIdMasked ?? "Not recorded"} · Event {payment.eventIdMasked ?? "Not recorded"}</span></li>)}</ul>
      </div>
      <div><h4>Refunds</h4><p>{coverageText[detail.recent.refunds.coverage]} Recorded update order; pending, failed or cancelled rows do not contribute to succeeded-refund proof.</p>
        <ul>{detail.recent.refunds.rows.map(refund => <li key={refund.rowId}><strong>{words(refund.status)}</strong> · {amount(refund.amountCents, refund.currency)} · {localTime(refund.updatedAt)}<span>Refund {refund.refundIdMasked} · Intent {refund.intentIdMasked} · Event {refund.eventIdMasked}</span>{refund.reasonRecorded && <span>A reason is recorded; its text is withheld.</span>}{refund.failureReasonRecorded && <span>A failure reason is recorded; its text is withheld.</span>}</li>)}</ul>
      </div>
      <div><h4>Audit</h4><p>{coverageText[detail.recent.audit.coverage]} Recorded creation order · {detail.recent.audit.scope === "owner" ? "Exact owner source" : "Exception-series source, including recurring recorded exceptions"}.</p>
        <ul>{detail.recent.audit.rows.map(audit => <li key={audit.rowId}><strong>{words(audit.action, "Unrecognized recorded action")}</strong> · {localTime(audit.recordedAt)}<span>Recorded amount {audit.facts.amountCents === null ? "Not recorded" : `${audit.facts.amountCents} cents; audit currency not supplied`} · Received money {audit.facts.moneyReceived === null ? "not recorded" : audit.facts.moneyReceived ? "recorded" : "not affirmative"}</span>{audit.facts.safeReasonCode && <span>{words(audit.facts.safeReasonCode)}</span>}</li>)}</ul>
      </div>
    </div>
    {Object.values(detail.coverage).some(value => value === "capped" || value === "unverified") && <p className="billingDetailLimits">Read limits: {Object.entries(detail.coverage).filter(([, value]) => value === "capped" || value === "unverified").map(([name, value]) => `${words(name)}: ${words(value)}`).join("; ")}.</p>}
  </div>;
}

export type BillingWorkspaceViewProps = {
  rows: BillingException[]; finished: boolean; loading?: boolean; selectedId?: string | null;
  detail?: BillingDetail | null; detailLoading?: boolean; notice?: string; warning?: boolean;
  loaded?: boolean; onSelect?: (row: BillingException) => void; contextRef?: Ref<HTMLElement>;
};
export function BillingWorkspaceView({ rows, finished, loading, selectedId, detail, detailLoading, notice, warning, loaded = true, onSelect, contextRef }: BillingWorkspaceViewProps) {
  return <div className="billingWorkspace">
    {notice && <p className={`billingNotice${warning ? " isWarning" : ""}`} role={warning ? "alert" : "status"}>{notice}</p>}
    <div className="billingColumns">
      <section aria-label="Recorded exception queue" aria-busy={loading || undefined}>
        <p className="billingCoverage">{!loaded ? loading ? "Loading recorded pages…" : "Reload records to read verified pages." : finished ? "These pages have finished loading. Reload records for current facts." : "These pages are partly loaded. Continue loading; current exception status can change between reads."}</p>
        {finished && rows.length === 0 && <p>No matching exceptions were recorded in these pages. This does not prove healthy billing or no charge.</p>}
        <ul className="billingQueue">{rows.map(row => <li key={row.exceptionId}>
          <button type="button" disabled={!onSelect || loading} onClick={() => onSelect?.(row)} aria-pressed={selectedId === row.exceptionId}>
            <strong>{exceptionLabel(row)}</strong><span>{reference(row)} · {row.status}</span>
            <span>Recorded exception amount: {amount(row.amountCents, row.currency)}</span>
            <span>{row.moneyReceived ? "Received money recorded" : "No received-money fact on this exception; not proof of no charge"}</span>
            <span>{row.occurrenceCount} recorded occurrence{row.occurrenceCount === 1 ? "" : "s"} · Last seen {localTime(row.lastSeenAt)}, Los Angeles</span>
            <span className="billingViewLabel">View details</span>
          </button>
        </li>)}</ul>
      </section>
      <section ref={contextRef} tabIndex={-1} className="billingContext" aria-label="Selected billing evidence" aria-busy={detailLoading || undefined}>
        {detailLoading ? <p role="status">Loading the exact selected record…</p> : detail ? <BillingDetailView detail={detail} /> : <p>Choose a recorded exception to read fresh evidence.</p>}
      </section>
    </div>
  </div>;
}

const fixedErrors: Record<BillingHttpErrorCode, string> = {
  billing_request_rejected: "The billing read request was rejected. Reload records.",
  billing_auth_required: "Sign in with an authorized staff account to read billing records.",
  billing_access_denied: "This account cannot read billing records. Protected facts have been cleared.",
  billing_record_not_found: "The selected billing record was not found. Reload records before relying on it.",
  billing_cursor_invalid: "These billing pages could not be continued. Reload records.",
  billing_read_unverified: "Billing evidence could not be verified. Protected facts have been cleared. Reload records."
};
const errorStatus: Record<BillingHttpErrorCode, number> = { billing_request_rejected: 400, billing_auth_required: 401, billing_access_denied: 403, billing_record_not_found: 404, billing_cursor_invalid: 400, billing_read_unverified: 502 };
class BillingReadError extends Error {}
async function readBody(response: Response) {
  const value: unknown = await response.json();
  if (!response.ok) {
    const body = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
    const code = body?.code as BillingHttpErrorCode;
    const known = body && Object.keys(body).length === 2 && Object.keys(body).every(key => key === "code" || key === "error") && typeof body.error === "string" && Object.hasOwn(fixedErrors, code) && errorStatus[code] === response.status;
    throw new BillingReadError(known ? fixedErrors[code] : fixedErrors.billing_read_unverified);
  }
  return value;
}
export function AdminBillingClient() {
  const session = useStaffSession();
  return <BillingSessionClient key={`${session.status}:${session.email ?? ""}`} />;
}
function BillingSessionClient() {
  const session = useStaffSession();
  const identity = `${session.status}:${session.email ?? ""}`;
  const mounted = useRef(true); const epoch = useRef(0);
  const live = useRef({ identity, staffFetch: session.staffFetch });
  useLayoutEffect(() => { live.current = { identity, staffFetch: session.staffFetch }; }, [identity, session.staffFetch]);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current += 1; }; }, []);
  const queueGeneration = useRef(0); const detailGeneration = useRef(0);
  const queueBusy = useRef(false); const activeTraversal = useRef<BillingTraversal | null>(null);
  const [status, setStatus] = useState<BillingExceptionStatus>("open");
  const [traversal, setTraversal] = useState<BillingTraversal | null>(null);
  const [role, setRole] = useState<BillingRole | null>(null);
  const [readScope, setReadScope] = useState<{ identity: string; staffFetch: typeof session.staffFetch } | null>(null);
  const [pendingScope, setPendingScope] = useState<{ identity: string; staffFetch: typeof session.staffFetch } | null>(null);
  const [loading, setLoading] = useState(false); const [detailLoading, setDetailLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null); const [detail, setDetail] = useState<BillingDetail | null>(null);
  const [notice, setNotice] = useState(""); const [warning, setWarning] = useState(false);
  const detailContext = useRef<HTMLElement>(null); const filterId = useId();
  const signedIn = session.status === "signed-in";
  const factsCurrent = readScope?.identity === identity && readScope.staffFetch === session.staffFetch;
  const pendingCurrent = pendingScope?.identity === identity && pendingScope.staffFetch === session.staffFetch;
  const verifiedRole = factsCurrent ? role : null;
  function guard() {
    const authEpoch = epoch.current, fetch = session.staffFetch;
    return () => mounted.current && epoch.current === authEpoch && live.current.identity === identity && live.current.staffFetch === fetch;
  }
  function clearDetail() { detailGeneration.current += 1; setSelectedId(null); setDetail(null); setDetailLoading(false); }
  function clearFacts() {
    queueGeneration.current += 1; queueBusy.current = false; activeTraversal.current = null;
    setTraversal(null); setRole(null); setReadScope(null); setLoading(false); clearDetail();
  }
  function fail(error: unknown) {
    clearFacts(); setNotice(error instanceof BillingReadError ? error.message : fixedErrors.billing_read_unverified); setWarning(true);
  }
  async function loadQueue(nextStatus: BillingExceptionStatus, resume = false) {
    if (!signedIn || (resume && queueBusy.current)) return;
    const currentSession = guard();
    clearDetail();
    const generation = ++queueGeneration.current;
    const current = () => currentSession() && queueGeneration.current === generation;
    queueBusy.current = true; setLoading(true); setNotice(""); setWarning(false);
    setPendingScope({ identity, staffFetch: session.staffFetch });
    let initial = resume && factsCurrent ? activeTraversal.current : null;
    if (!initial || initial.query.status !== nextStatus) initial = startBillingTraversal(nextStatus);
    if (!resume) { activeTraversal.current = null; setTraversal(null); setRole(null); }
    try {
      const result = await readBillingBatch(initial, async request => {
        const params = new URLSearchParams({ page: "1", status: request.status, limit: String(request.limit) });
        if (request.cursor) params.set("cursor", request.cursor); if (request.endCursor) params.set("endCursor", request.endCursor);
        const normalized = normalizeBillingPageRequest(params);
        const value = await readBody(await session.staffFetch(`/api/admin/exceptions?${params}`));
        if (!current()) throw new BillingReadError(fixedErrors.billing_read_unverified);
        return parseBillingExceptionPage(value, { ...normalized, cutoff: request.cutoff });
      }, current);
      if (!result || !current()) return;
      activeTraversal.current = result; setTraversal(result); setRole(result.role ?? null);
      setReadScope({ identity, staffFetch: session.staffFetch });
      setNotice(result.segments.length ? "More recorded pages remain to be loaded." : "These pages have finished loading. Reload records for current facts.");
    } catch (error) { if (current()) fail(error); }
    finally { if (current()) { queueBusy.current = false; setLoading(false); } }
  }
  async function select(row: BillingException) {
    if (!signedIn || queueBusy.current || !factsCurrent || !verifiedRole) return;
    const currentSession = guard(); const generation = ++detailGeneration.current;
    const queueEpoch = queueGeneration.current;
    const current = () => currentSession() && detailGeneration.current === generation && queueGeneration.current === queueEpoch;
    setSelectedId(row.exceptionId); setDetail(null); setDetailLoading(true); setNotice(""); setWarning(false);
    setPendingScope({ identity, staffFetch: session.staffFetch });
    try {
      const params = new URLSearchParams({ exceptionId: row.exceptionId });
      const request = normalizeBillingDetailRequest(params);
      const value = await readBody(await session.staffFetch(`/api/admin/billing/detail?${params}`));
      if (!current()) return;
      const fresh = parseBillingDetail(value, request);
      if (fresh.role !== verifiedRole) throw new BillingReadError(fixedErrors.billing_read_unverified);
      setDetail(fresh); setRole(fresh.role); setNotice("Fresh recorded evidence loaded. No live provider check was made.");
    } catch (error) { if (current()) fail(error); }
    finally { if (current()) setDetailLoading(false); }
  }
  const started = useRef(false);
  useEffect(() => { if (signedIn && !started.current) { started.current = true; void loadQueue("open"); } }, [signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (detail) detailContext.current?.focus(); }, [detail]);
  return <div className="billingDesk">
    <div className="billingTitle"><h1>Billing exceptions</h1><p>Read recorded evidence and recovery history. This desk makes no live provider check or financial change.</p></div>
    <div className="billingSession">{signedIn ? <><p>Signed in as <strong>{session.email ?? "authorized staff"}</strong>{verifiedRole === "viewer" ? " · Read only" : ""}</p><button type="button" onClick={() => { clearFacts(); epoch.current += 1; void session.signOut().catch(() => { setNotice("Staff sign-out could not be confirmed. Sign in again before relying on billing evidence."); setWarning(true); }); }}>Sign out</button></>
      : <p>{session.status === "unconfigured" ? "Staff sign-in is not configured yet." : session.status === "loading" || session.status === "signing-out" ? "Checking staff access…" : <>Sign in with an authorized staff account. <Link href="/staff-sign-in?returnTo=/admin/billing">Staff sign in</Link></>}</p>}</div>
    {signedIn && <div className="billingReadControls">
      <label htmlFor={filterId}>Recorded exception status<select id={filterId} value={status} onChange={event => { const next = event.target.value as BillingExceptionStatus; setStatus(next); clearFacts(); void loadQueue(next); }}><option value="open">Open</option><option value="resolved">Resolved</option></select></label>
      <button type="button" onClick={() => void loadQueue(status)}>Reload records</button>
      {factsCurrent && traversal && traversal.segments.length > 0 && <button type="button" disabled={loading && pendingCurrent} onClick={() => { if (!queueBusy.current) void loadQueue(status, true); }}>Load more</button>}
    </div>}
    <BillingWorkspaceView rows={signedIn && factsCurrent ? traversal?.rows ?? [] : []} finished={Boolean(factsCurrent && traversal && traversal.segments.length === 0)} loading={loading && pendingCurrent} loaded={factsCurrent}
      selectedId={factsCurrent ? selectedId : null} detail={signedIn && factsCurrent ? detail : null} detailLoading={detailLoading && pendingCurrent} notice={pendingCurrent ? notice : ""} warning={warning}
      onSelect={signedIn && verifiedRole ? row => void select(row) : undefined} contextRef={detailContext} />
  </div>;
}
