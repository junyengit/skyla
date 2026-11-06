"use client";

import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type Ref } from "react";
import { addVisitDays, formatVisitDateLabel, venueToday } from "@skyla/payments";
import { useStaffSession } from "@/components/staff-auth-provider";
import {
  normalizeCalendarCancelRequest, normalizeCalendarCreateRequest, normalizeCalendarRange,
  parseCalendarMutationRejection, parseCalendarMutationResult, parseCalendarOperationResult, parseCalendarRangePage,
  type CalendarEvent, type CalendarMutationIdentity, type CalendarOperationLookup, type CalendarRange, type CalendarRole
} from "@/lib/calendar-contract";
import {
  acceptCalendarPage, calendarEventProvesCreate, calendarLockMessage, calendarOperationFor,
  calendarOperationIsCurrent, clearCalendarOperation, claimCalendarOperation, newCalendarKey,
  parseCalendarOperationSnapshot, readCalendarOperationSlot, readCalendarOperationSnapshot,
  sameCalendarOperation, startCalendarTraversal, subscribeCalendarOperation, withCalendarOperationLock,
  type CalendarOperation, type CalendarTraversal
} from "@/lib/calendar-recovery";

const readToday = () => venueToday(Date.now());
const subscribeToday = (change: () => void) => {
  const timer = window.setInterval(change, 60_000);
  return () => window.clearInterval(timer);
};
const noServerDate = () => "";
const calendarDateLabel = (date: string) => `${formatVisitDateLabel(date)}, ${date.slice(0, 4)}`;
const errorText = (error: unknown) => error instanceof Error ? error.message : "The result could not be verified. Check status before trying again.";
const operationLookup = (operation: CalendarOperation): CalendarOperationLookup => operation.kind === "create" ? { key: operation.key } : { eventRef: operation.eventRef };
function lookupUrl(lookup: CalendarOperationLookup) {
  return `/api/admin/private-events/operation?${new URLSearchParams("key" in lookup ? { key: lookup.key } : { event: lookup.eventRef })}`;
}
class CalendarHttpError extends Error {
  constructor(message: string, readonly status: number, readonly verifiedNoCommit = false) { super(message); }
}
async function responseBody(response: Response, expectedMutation?: CalendarMutationIdentity): Promise<unknown> {
  const value: unknown = await response.json();
  if (!response.ok) {
    if (response.status === 409 && expectedMutation) {
      // Only an exact typed atomic receipt can prove this particular request did not commit.
      try {
        const rejection = parseCalendarMutationRejection(value, expectedMutation);
        throw new CalendarHttpError(rejection.message, response.status, true);
      } catch (error) { if (error instanceof CalendarHttpError) throw error; }
    }
    const error = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
    const canonical = error && typeof error.error === "string" && error.error.trim() &&
      Object.keys(error).every(key => ["error", "code"].includes(key)) && (error.code === undefined || typeof error.code === "string");
    throw new CalendarHttpError(canonical ? error.error as string : "The result could not be verified.", response.status);
  }
  return value;
}

/** Pure production presentation. External fixtures must label their synthetic data. */
export function CalendarEventDetails({ event }: { event: CalendarEvent }) {
  return <div className="calendarEventDetails">
    <h2>{event.label}</h2>
    <p><time dateTime={event.visitDate}>{calendarDateLabel(event.visitDate)}</time> · {event.status === "confirmed" ? "Reserved for the whole Los Angeles date" : "Cancelled block"}</p>
    <p>{event.confirmationSource ? `${event.confirmationSource === "owner-confirmation" ? "Owner confirmation" : "Booking record"}: ${event.sourceRef}` : "Source not recorded. This retained record still blocks its date while confirmed."}</p>
    {event.notes && <p>{event.notes}</p>}
    <p className="calendarReference">{event.eventRef}</p>
    {event.status === "cancelled" && <p>First cancellation reason: {event.cancelReason}. Cancelling this block does not confirm available capacity.</p>}
  </div>;
}
export type CalendarWorkspaceViewProps = {
  range: CalendarRange | null; events: CalendarEvent[]; complete: boolean; loading?: boolean;
  verified?: boolean; notice?: string; warning?: boolean; selected?: CalendarEvent | null;
  onSelect?: (event: CalendarEvent) => void; contextRef?: Ref<HTMLElement>; children?: ReactNode;
};
export function CalendarWorkspaceView({ range, events, complete, loading, verified = true, notice, warning, selected, onSelect, contextRef, children }: CalendarWorkspaceViewProps) {
  return <div className="calendarWorkspace">
    {notice && <p className={`calendarNotice${warning ? " isWarning" : ""}`} role={warning ? "alert" : "status"}>{notice}</p>}
    <div className="calendarColumns">
      <section className="calendarRecords" aria-label="Recorded private events" aria-busy={loading || undefined}>
        <p className="calendarCoverage">{!range ? "Choose a date range to load recorded blocks." : !verified ? "This range is not verified. Refresh before relying on it." : complete
          ? `All recorded blocks created before this read are loaded for ${calendarDateLabel(range.from)} to ${calendarDateLabel(range.to)}. This is not a capacity check.`
          : "This range is only partly loaded. Continue loading before relying on its coverage."}</p>
        {events.length === 0 && range && verified && complete && <p>No recorded private-event blocks in this covered range. External reservations and normal-visit capacity still need checking.</p>}
        <ul className="calendarRecordList">{events.map(event => <li key={event.eventRef}>
          <button type="button" disabled={!onSelect || loading || !verified} aria-pressed={selected?.eventRef === event.eventRef}
            onClick={() => onSelect?.(event)}>
            <time dateTime={event.visitDate}>{calendarDateLabel(event.visitDate)}</time>
            <strong>{event.label}</strong><span>{event.status === "confirmed" ? "Confirmed · full day" : "Cancelled"}</span>
            <span>{event.confirmationSource ? `${event.confirmationSource === "owner-confirmation" ? "Owner confirmation" : "Booking record"}: ${event.sourceRef}` : "Source not recorded"}</span>
          </button>
        </li>)}</ul>
      </section>
      <section ref={contextRef} tabIndex={-1} className="calendarContext calendarFocusContext" aria-label="Selected event or confirmation">{selected && <CalendarEventDetails event={selected} />}{children}</section>
    </div>
  </div>;
}

export type CalendarConfirmationFields = { visitDate: string; label: string; source: "owner-confirmation" | "booking-record"; sourceRef: string; notes: string };
export function CalendarConfirmationForm({ id, values, recovery = false, busy = false, onChange, onSubmit, onClose }: {
  id: string; values: CalendarConfirmationFields; recovery?: boolean; busy?: boolean;
  onChange?: (field: keyof CalendarConfirmationFields, value: string) => void; onSubmit?: () => void; onClose?: () => void;
}) {
  const disabled = busy || !onSubmit;
  return <form className="calendarEventForm" onSubmit={event => { event.preventDefault(); onSubmit?.(); }}>
    <h2>{recovery ? "Restore original confirmation" : "Record confirmed event"}</h2>
    <p>{recovery ? "Re-enter the exact original date, label, source and notes. Changed details cannot be retried as this confirmation." : "Use a confirmed source, not an inquiry. This records a full-day block; it does not issue a bill or confirm payment."}</p>
    <label htmlFor={`${id}-date`}>Event date, Los Angeles<input id={`${id}-date`} type="date" required value={values.visitDate} disabled={disabled} onChange={event => onChange?.("visitDate", event.target.value)} /></label>
    <label htmlFor={`${id}-label`}>Event label<input id={`${id}-label`} required maxLength={120} value={values.label} disabled={disabled} onChange={event => onChange?.("label", event.target.value)} /></label>
    <label htmlFor={`${id}-source`}>Confirmed by<select id={`${id}-source`} value={values.source} disabled={disabled} onChange={event => onChange?.("source", event.target.value)}><option value="owner-confirmation">Owner confirmation</option><option value="booking-record">Booking record</option></select></label>
    <label htmlFor={`${id}-source-ref`}>Confirmation source reference<input id={`${id}-source-ref`} required maxLength={200} value={values.sourceRef} disabled={disabled} placeholder="Where the confirmation is recorded" onChange={event => onChange?.("sourceRef", event.target.value)} /></label>
    <label htmlFor={`${id}-notes`}>Notes, optional<textarea id={`${id}-notes`} maxLength={500} value={values.notes} disabled={disabled} onChange={event => onChange?.("notes", event.target.value)} /></label>
    <button type="submit" disabled={disabled}>{recovery ? "Retry original confirmation" : "Confirm full-day block"}</button>
    <button type="button" disabled={busy || !onClose} onClick={onClose}>Close form</button>
  </form>;
}
export function CalendarCancellationForm({ id, reason, busy = false, onChange, onSubmit }: {
  id: string; reason: string; busy?: boolean; onChange?: (reason: string) => void; onSubmit?: () => void;
}) {
  return <form className="calendarEventForm" onSubmit={event => { event.preventDefault(); onSubmit?.(); }}>
    <p>Cancel only this block. Keep the booking, its billing and any required guest communication separate. Capacity is checked again for later purchases.</p>
    <label htmlFor={`${id}-reason`}>Cancellation reason<textarea id={`${id}-reason`} required maxLength={300} value={reason} disabled={busy || !onSubmit} onChange={event => onChange?.(event.target.value)} /></label>
    <button type="submit" disabled={busy || !onSubmit}>Cancel this block</button>
  </form>;
}
export function CalendarRecoveryPanel({ id, kind, busy = false, canRetry = false, restoreReason = false, reason = "", onCheck, onRetry, onReasonChange, onCancelRetry }: {
  id: string; kind: "create" | "cancel"; busy?: boolean; canRetry?: boolean; restoreReason?: boolean; reason?: string;
  onCheck?: () => void; onRetry?: () => void; onReasonChange?: (reason: string) => void; onCancelRetry?: () => void;
}) {
  return <div className="calendarRecovery">
    <p role="status">A {kind === "create" ? "confirmation" : "cancellation"} needs verification. It is retained on this browser after reload. Do not start another change.</p>
    <button type="button" disabled={busy || !onCheck} onClick={onCheck}>Check status</button>
    {canRetry && <button type="button" disabled={busy || !onRetry} onClick={onRetry}>Retry same change</button>}
    {restoreReason && kind === "cancel" && canRetry && <form onSubmit={event => { event.preventDefault(); onCancelRetry?.(); }}>
      <label htmlFor={`${id}-retry-reason`}>Original cancellation reason<textarea id={`${id}-retry-reason`} maxLength={300} required value={reason} disabled={busy || !onCancelRetry} onChange={event => onReasonChange?.(event.target.value)} /></label>
      <button type="submit" disabled={busy || !onCancelRetry}>Retry original cancellation</button>
    </form>}
  </div>;
}

export function AdminCalendarClient() {
  const session = useStaffSession();
  // Genuine provider identity changes naturally discard local role/form/read authority.
  return <CalendarClientSession key={`${session.status}:${session.email ?? ""}`} />;
}
function CalendarClientSession() {
  const session = useStaffSession();
  const today = useSyncExternalStore(subscribeToday, readToday, noServerDate);
  const rawOperation = useSyncExternalStore(subscribeCalendarOperation, readCalendarOperationSnapshot, () => null);
  const slot = parseCalendarOperationSnapshot(rawOperation);
  const operation = slot.kind === "operation" ? slot.operation : null;
  const identity = `${session.status}:${session.email ?? ""}`;
  const liveIdentity = useRef(identity);
  const mounted = useRef(true);
  const epoch = useRef(0);
  const action = useRef<object | null>(null);
  const rangeGeneration = useRef(0);
  const rangeBusy = useRef(false);
  const traversalRef = useRef<CalendarTraversal | null>(null);
  const frozenRequest = useRef<{ identity: CalendarMutationIdentity; operation: CalendarOperation } | null>(null);
  const autoLoaded = useRef(false);
  const [roleState, setRoleState] = useState<{ identity: string; role: CalendarRole } | null>(null);
  const role = roleState?.identity === identity && session.status === "signed-in" ? roleState.role : null;
  const liveRole = useRef(role);
  useLayoutEffect(() => { liveIdentity.current = identity; liveRole.current = role; }, [identity, role]);
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [traversal, setTraversal] = useState<CalendarTraversal | null>(null);
  const [rangeVerified, setRangeVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(""); const [warning, setWarning] = useState(false);
  const [verifiedOutcome, setVerifiedOutcome] = useState<{ text: string; warning: boolean } | null>(null);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [context, setContext] = useState<"none" | "create" | "record">("none");
  const [visitDate, setVisitDate] = useState(""); const [label, setLabel] = useState("");
  const [source, setSource] = useState<"owner-confirmation" | "booking-record">("owner-confirmation");
  const [sourceRef, setSourceRef] = useState(""); const [notes, setNotes] = useState("");
  const [reason, setReason] = useState(""); const [reentryRequired, setReentryRequired] = useState(false);
  const detailHeading = useRef<HTMLElement>(null);
  const formId = useId();
  const signedIn = session.status === "signed-in";
  const canMutate = signedIn && role === "admin" && !busy && slot.kind === "empty";
  const message = (text: string, isWarning = false) => { setNotice(text); setWarning(isWarning); };
  function capture() {
    const token = { epoch: epoch.current, identity };
    return () => mounted.current && token.epoch === epoch.current && liveIdentity.current === token.identity;
  }
  function beginAction() {
    if (action.current || !signedIn) return null;
    const token = {}; action.current = token; setBusy(true);
    const currentSession = capture();
    return { current: () => currentSession() && action.current === token, finish: () => {
      if (action.current === token) { action.current = null; if (currentSession()) setBusy(false); }
    } };
  }
  function verifyRole(replyRole: CalendarRole, current: () => boolean) { if (current()) setRoleState({ identity, role: replyRole }); }
  function invalidateRange() {
    rangeGeneration.current += 1; rangeBusy.current = false;
    traversalRef.current = null; setTraversal(null); setRangeVerified(false); setLoading(false);
  }
  function handleReadError(error: unknown) {
    if (error instanceof CalendarHttpError && [401, 403].includes(error.status)) setRoleState(null);
    message(errorText(error), true);
  }
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; epoch.current += 1; rangeGeneration.current += 1; };
  }, []);
  useEffect(() => {
    if (frozenRequest.current && (!operation || !sameCalendarOperation(operation, frozenRequest.current.operation))) frozenRequest.current = null;
    // A foreign operation also removes old selected controls. Durable identity remains untouched.
    if (operation && !frozenRequest.current) { setSelected(null); setContext("none"); }
  // The stable raw storage snapshot is the dependency, not a freshly parsed object.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawOperation]);
  useEffect(() => { if (context !== "none") detailHeading.current?.focus(); }, [context, selected?.eventRef]);

  async function loadRange(range: CalendarRange, resume = false, announce = true) {
    if (!signedIn || rangeBusy.current) return;
    const currentSession = capture();
    const generation = ++rangeGeneration.current;
    const current = () => currentSession() && rangeGeneration.current === generation;
    rangeBusy.current = true; setLoading(true);
    let state = resume ? traversalRef.current : startCalendarTraversal(range);
    if (!state || state.range.from !== range.from || state.range.to !== range.to) state = startCalendarTraversal(range);
    if (!resume) { setTraversal(state); traversalRef.current = state; setSelected(null); if (context === "record") setContext("none"); setRangeVerified(false); }
    try {
      // A bounded batch. Split/empty pages can consume it without making a false completion claim.
      for (let count = 0; count < 8 && state.segments.length; count += 1) {
        const segment = state.segments[0]!;
        const params = new URLSearchParams(state.range);
        if (segment.cursor) params.set("cursor", segment.cursor);
        if (segment.endCursor) params.set("endCursor", segment.endCursor);
        const value = await responseBody(await session.staffFetch(`/api/admin/private-events?${params}`));
        if (!current()) return;
        const page = parseCalendarRangePage(value, { ...state.range, ...segment, cutoff: state.cutoff });
        state = acceptCalendarPage(state, page);
        if (!current()) return;
        verifyRole(page.role, current); traversalRef.current = state; setTraversal(state); setRangeVerified(true);
      }
      if (current() && announce) message(state.segments.length ? "More records remain to be loaded." : "The selected range has finished loading.");
    } catch (error) { if (current()) { setRangeVerified(false); handleReadError(error); } }
    finally { if (current()) { rangeBusy.current = false; setLoading(false); } }
  }
  useEffect(() => {
    if (!signedIn) { autoLoaded.current = false; return; }
    if (today && !autoLoaded.current) {
      autoLoaded.current = true; const range = { from: today, to: addVisitDays(today, 29) };
      setFrom(range.from); setTo(range.to); setVisitDate(today); void loadRange(range);
    }
  // The actual provider remounts for user/status changes; today is a hydrated LA date.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, today, identity]);

  async function selectEvent(event: CalendarEvent) {
    const task = beginAction(); if (!task) return;
    setSelected(null); setContext("none"); setReason("");
    try {
      const value = await responseBody(await session.staffFetch(lookupUrl({ eventRef: event.eventRef })));
      if (!task.current()) return;
      const result = parseCalendarOperationResult(value, { eventRef: event.eventRef }); verifyRole(result.role, task.current);
      if (!result.event) throw new Error("This record could not be found. Refresh the range before acting on it.");
      setSelected(result.event); setContext("record"); message("Current record loaded.");
    } catch (error) { if (task.current()) handleReadError(error); } finally { task.finish(); }
  }
  function updateForm(change: () => void) { if (!action.current) change(); }
  function openCreate(recover = false) {
    if (action.current || rangeBusy.current || role !== "admin" || (!recover && slot.kind !== "empty")) return;
    setSelected(null); setContext("create"); setReentryRequired(recover);
    if (!recover) { setVisitDate(today); setLabel(""); setSource("owner-confirmation"); setSourceRef(""); setNotes(""); }
  }
  async function readOperation(expected: CalendarOperation, current: () => boolean) {
    const lookup = operationLookup(expected);
    const value = await responseBody(await session.staffFetch(lookupUrl(lookup)));
    if (!current() || !calendarOperationIsCurrent(expected)) return null;
    const result = parseCalendarOperationResult(value, lookup); verifyRole(result.role, current);
    return result;
  }
  async function finishVerified(event: CalendarEvent, expected: CalendarOperation, current: () => boolean) {
    if (!current() || !calendarOperationIsCurrent(expected)) return;
    const cleared = clearCalendarOperation(expected);
    if (!current()) return;
    setSelected(event); setContext("record"); setReentryRequired(false);
    const outcome = event.status === "cancelled" ? "The block is cancelled. Its original record and first reason are retained. Available capacity still needs checking."
      : "The confirmed block is recorded for the whole Los Angeles date. This does not record a payment.";
    setVerifiedOutcome({ text: cleared === "cleared" || cleared === "empty" ? outcome : `${outcome} This browser could not finish recovery cleanup; check status before another change.`, warning: cleared !== "cleared" && cleared !== "empty" });
    message("");
    frozenRequest.current = null; invalidateRange();
    // Preserve the verified outcome if refreshing fails; a separate unverified coverage notice remains.
  }
  async function checkOperation() {
    const expected = operation;
    const task = beginAction(); if (!task || !expected) { task?.finish(); return; }
    try {
      const locked = await withCalendarOperationLock(async () => {
        if (!task.current() || !calendarOperationIsCurrent(expected)) return;
        const result = await readOperation(expected, task.current);
        if (!result || !task.current()) return;
        if (result.event && (expected.kind === "cancel" ? result.event.status === "cancelled" : await calendarEventProvesCreate(result.event, expected))) {
          if (task.current()) await finishVerified(result.event, expected, task.current);
        } else {
          if (!task.current() || !calendarOperationIsCurrent(expected)) return;
          if (result.event && expected.kind === "create") message("The returned record does not match the original confirmation. Keep this operation for review; do not create another.", true);
          else {
            if (result.event) { setSelected(result.event); setContext("record"); }
            if (expected.kind === "create" && !frozenRequest.current) setReentryRequired(true);
            message("The original change is still not verified. Its absence does not prove failure. Check status or retry the exact same confirmation.", true);
          }
        }
      });
      if (task.current() && locked.status !== "held") message(calendarLockMessage[locked.status], true);
    } catch (error) { if (task.current()) handleReadError(error); } finally { task.finish(); }
  }
  async function mutate(identityRequest: CalendarMutationIdentity, prior: CalendarOperation | null) {
    if (liveRole.current !== "admin") return;
    const task = beginAction(); if (!task) return;
    setVerifiedOutcome(null);
    message("Checking the confirmation before sending it…");
    let expected: CalendarOperation | null = null;
    let sent = false;
    try {
      expected = await calendarOperationFor(identityRequest);
      if (!task.current() || liveRole.current !== "admin") return;
      if (prior && !sameCalendarOperation(expected, prior)) throw new Error(identityRequest.kind === "create"
        ? "These details do not match the original confirmation. Restore the exact date, label, source and notes before retrying."
        : "These details do not match the original cancellation. Restore its exact original reason before retrying.");
      const locked = await withCalendarOperationLock(async () => {
        if (!task.current() || liveRole.current !== "admin") return;
        const slotNow = readCalendarOperationSlot();
        if (prior ? !calendarOperationIsCurrent(prior) : slotNow.kind !== "empty") throw new Error("Another calendar change needs recovery first. Nothing was sent.");
        if (prior?.kind === "create") {
          const recovered = await readOperation(prior, task.current);
          if (!recovered || !task.current() || liveRole.current !== "admin") return;
          if (recovered.role !== "admin") throw new Error("This account can only read the calendar. Nothing was sent.");
          if (recovered.event) {
            if (!await calendarEventProvesCreate(recovered.event, prior)) throw new Error("The returned record does not match the original confirmation. Keep this operation for review; do not create another.");
            if (task.current()) await finishVerified(recovered.event, prior, task.current);
            return;
          }
        }
        if (identityRequest.kind === "cancel") {
          // Re-read under the same lock, even if this record was just selected.
          const lookup = { eventRef: identityRequest.request.eventRef };
          const value = await responseBody(await session.staffFetch(lookupUrl(lookup)));
          if (!task.current() || liveRole.current !== "admin") return;
          const fresh = parseCalendarOperationResult(value, lookup); verifyRole(fresh.role, task.current);
          if (fresh.role !== "admin") throw new Error("This account can only read the calendar. Nothing was sent.");
          if (!fresh.event) throw new Error("The selected record could not be verified. Nothing was sent.");
          if (fresh.event.status === "cancelled") {
            if (prior) await finishVerified(fresh.event, prior, task.current);
            else { setSelected(fresh.event); setContext("record"); message("This block was already cancelled. Its first reason is retained."); invalidateRange(); }
            return;
          }
        }
        if (!task.current() || liveRole.current !== "admin") return;
        if (claimCalendarOperation(expected!) !== "claimed") throw new Error("This browser could not preserve this change safely. Nothing was sent. Check the pending operation.");
        frozenRequest.current = { identity: identityRequest, operation: expected! };
        setReentryRequired(false);
        // Remove the old action's authority before network work. The durable pointer now owns recovery.
        setSelected(null); setContext("none"); invalidateRange();
        if (!task.current() || !calendarOperationIsCurrent(expected!) || liveRole.current !== "admin") return;
        sent = true;
        const response = await session.staffFetch(identityRequest.kind === "create" ? "/api/admin/private-events" : "/api/admin/private-events/cancel", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(identityRequest.request)
        });
        const value = await responseBody(response, identityRequest);
        if (!task.current() || !calendarOperationIsCurrent(expected!)) return;
        const result = parseCalendarMutationResult(value, identityRequest); verifyRole(result.role, task.current);
        await finishVerified(result.event, expected!, task.current);
      });
      if (task.current() && locked.status !== "held") message(calendarLockMessage[locked.status], true);
    } catch (error) {
      if (task.current()) {
        // A receipt for a retry cannot disprove a prior unknown write. Never release that pointer.
        if (sent && expected && !prior && error instanceof CalendarHttpError && error.verifiedNoCommit) {
          const exact = expected;
          const cleanup = await withCalendarOperationLock(async () => task.current() && calendarOperationIsCurrent(exact) ? clearCalendarOperation(exact) : "different");
          if (!task.current()) return;
          if (cleanup.status === "held" && cleanup.value === "cleared") { frozenRequest.current = null; message(`${error.message} This change was rejected; no block was changed by this request.`, true); }
          else message(`${error.message} Recovery cleanup could not be verified. Check status before another change.`, true);
        } else if (sent) message("The change could not be verified. Do not start another confirmation. Check status or retry the same change.", true);
        else message(errorText(error), true);
        if (error instanceof CalendarHttpError && [401, 403].includes(error.status)) setRoleState(null);
      }
    } finally { task.finish(); }
  }
  function submitCreate() {
    if (action.current || role !== "admin") return;
    const prior = operation?.kind === "create" ? operation : null;
    if (slot.kind !== "empty" && !prior) return;
    try {
      const request = normalizeCalendarCreateRequest({ visitDate, label, notes, confirmationSource: source, sourceRef,
        idempotencyKey: prior?.key ?? newCalendarKey() });
      if (!request.confirmationSource || !request.sourceRef) throw new Error("Record where this event was confirmed before reserving its date.");
      void mutate({ kind: "create", request }, prior);
    } catch (error) { message(errorText(error), true); }
  }
  function submitCancel() {
    if (action.current || !selected || role !== "admin" || slot.kind !== "empty") return;
    try { void mutate({ kind: "cancel", request: normalizeCalendarCancelRequest({ eventRef: selected.eventRef, reason }) }, null); }
    catch (error) { message(errorText(error), true); }
  }
  function retryFrozen() {
    if (action.current || role !== "admin" || !operation) return;
    const frozen = frozenRequest.current;
    if (frozen && sameCalendarOperation(frozen.operation, operation)) void mutate(frozen.identity, operation);
    else if (operation.kind === "create") openCreate(true);
    else { setReentryRequired(true); message("Enter the original cancellation reason after checking status to retry this exact change.", true); }
  }
  function retryCancel() {
    if (action.current || role !== "admin" || operation?.kind !== "cancel") return;
    try { void mutate({ kind: "cancel", request: normalizeCalendarCancelRequest({ eventRef: operation.eventRef, reason }) }, operation); }
    catch (error) { message(errorText(error), true); }
  }

  return <div className="calendarDesk">
    <div className="calendarTitle"><h1>Private-event calendar</h1><p>Confirmed events reserve the whole Los Angeles date. Inquiries and payment records do not reserve a date here.</p></div>
    <div className="calendarSession">
      {signedIn ? <><p>Signed in as <strong>{session.email ?? "authorized staff"}</strong>{role === "viewer" ? " · Read only" : ""}</p>
        <button type="button" disabled={busy} onClick={() => { if (!action.current) void session.signOut().catch(error => message(errorText(error), true)); }}>Sign out</button></>
        : <p>{session.status === "unconfigured" ? "Staff sign-in is not configured yet." : session.status === "loading" || session.status === "signing-out" ? "Checking staff access…" : <>Sign in with an authorized staff account. <Link href="/staff-sign-in?returnTo=/admin/calendar">Staff sign in</Link></>}</p>}
    </div>
    {signedIn && <>
      <form className="calendarRange" onSubmit={event => { event.preventDefault(); if (rangeBusy.current || action.current) return; try { void loadRange(normalizeCalendarRange({ from, to })); } catch (error) { message(errorText(error), true); } }}>
        <label htmlFor={`${formId}-from`}>From, Los Angeles date<input id={`${formId}-from`} type="date" value={from} disabled={loading || busy} onChange={event => updateForm(() => { setFrom(event.target.value); invalidateRange(); setSelected(null); setContext("none"); })} /></label>
        <label htmlFor={`${formId}-to`}>Through, Los Angeles date<input id={`${formId}-to`} type="date" value={to} disabled={loading || busy} onChange={event => updateForm(() => { setTo(event.target.value); invalidateRange(); setSelected(null); setContext("none"); })} /></label>
        <button type="submit" disabled={loading || busy}>Refresh range</button>
        <button type="button" disabled={loading || busy || !today} onClick={() => { if (action.current || rangeBusy.current) return; const range = { from: addVisitDays(today, -30), to: addVisitDays(today, -1) }; setFrom(range.from); setTo(range.to); void loadRange(range); }}>Previous 30 days</button>
      </form>
      <div className="calendarToolbar">
        {traversal && traversal.segments.length > 0 && <button type="button" disabled={loading || busy || !rangeVerified} onClick={() => { if (!action.current && rangeVerified) void loadRange(traversal.range, true); }}>Load more records</button>}
        {role === "admin" && <button type="button" disabled={!canMutate || loading} onClick={() => openCreate()}>Record confirmed event</button>}
        {role === "viewer" && <p>This account can read recorded events. An admin must confirm or cancel a block.</p>}
      </div>
    </>}
    {operation && signedIn && <CalendarRecoveryPanel id={formId} kind={operation.kind} busy={busy} canRetry={role === "admin"}
      restoreReason={reentryRequired} reason={reason} onCheck={() => void checkOperation()} onRetry={retryFrozen}
      onReasonChange={value => updateForm(() => setReason(value))} onCancelRetry={retryCancel} />}
    {(slot.kind === "corrupt" || slot.kind === "unreadable") && signedIn && <p className="calendarNotice isWarning" role="alert">This browser cannot read its pending calendar change safely. Do not start another confirmation. Keep this browser data for review.</p>}
    {verifiedOutcome && signedIn && <p className={`calendarNotice${verifiedOutcome.warning ? " isWarning" : ""}`} role={verifiedOutcome.warning ? "alert" : "status"}>{verifiedOutcome.text}</p>}
    <CalendarWorkspaceView range={signedIn ? traversal?.range ?? null : null} events={signedIn ? traversal?.events ?? [] : []}
      complete={Boolean(traversal && traversal.segments.length === 0)} loading={loading} verified={rangeVerified}
      notice={notice} warning={warning} selected={signedIn ? selected : null} onSelect={signedIn && !busy ? event => void selectEvent(event) : undefined} contextRef={detailHeading}>
      <div>
        {signedIn && context === "create" && role === "admin" && <CalendarConfirmationForm id={formId}
          values={{ visitDate, label, source, sourceRef, notes }} recovery={operation?.kind === "create"}
          busy={busy || (slot.kind !== "empty" && operation?.kind !== "create")} onSubmit={submitCreate}
          onChange={(field, value) => updateForm(() => { if (field === "visitDate") setVisitDate(value); else if (field === "label") setLabel(value);
            else if (field === "source") setSource(value as typeof source); else if (field === "sourceRef") setSourceRef(value); else setNotes(value); })}
          onClose={() => { if (!action.current) setContext("none"); }} />}
        {signedIn && context === "record" && selected?.status === "confirmed" && role === "admin" && slot.kind === "empty" && <CalendarCancellationForm id={formId} reason={reason}
          busy={!canMutate} onChange={value => updateForm(() => setReason(value))} onSubmit={submitCancel} />}
      </div>
    </CalendarWorkspaceView>
  </div>;
}
