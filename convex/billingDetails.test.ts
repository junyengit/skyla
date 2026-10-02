import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConvexError } from "convex/values";
import type { BillingDetail } from "@skyla/payments";
import { createConvexHarness } from "./convexHarness.testkit";
import * as billingDetails from "./billingDetails";
import { parseBillingDetail } from "../apps/web/lib/billing-contract";
import { buildCheckoutDraftWrite, buildPosSaleDraftWrite } from "./lib/orderDraftPersistence";
import { billingDetailPlannedReads, maskBillingId, readBillingDetail } from "./lib/billingDetails";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

const now = Date.parse("2026-10-02T19:00:00Z");
const orderRef = "SKY2610-ORD001", saleRef = "SALE261002-SAL001", bookingRef = "SKY2610-BOOK01";
const intent = "pi_billingcanonical1234", session = "cs_billingcanonical5678";
type Raw = Record<string, unknown> & { _id: string; _creationTime: number };
function fixture(channel: "order" | "sale" = "order", cafe = false) {
  const h = createConvexHarness({ billingDetails });
  for (const role of ["admin", "viewer", "pos"]) h.seed("staffUsers", { subject: role, emailLower: "SECRET_EMAIL", role, active: true, createdAt: 1, updatedAt: 1 });
  const ref = channel === "order" ? orderRef : saleRef;
  const ownerKeys = channel === "order" ? { orderRef: ref } : { saleRef: ref };
  const admission = { packageKey: "general" as const, adults: 1, children: 1, freeChildren: 1, visitDate: "2026-10-02", entryTime: "12:00" };
  const build = channel === "order"
    ? buildCheckoutDraftWrite({ ...admission, idempotencyKey: "billing_fixture_key", customerEmail: "secret@example.com" }, { orderRef: ref, now })
    : buildPosSaleDraftWrite({ ...(cafe ? {} : { admission }), lines: cafe ? [{ kind: "custom", name: "SECRET_LINE_NAME", quantity: 1, amountCents: 3000, reason: "SECRET_CUSTOM_REASON" }] : [], idempotencyKey: "billing_fixture_key" }, { saleRef: ref, now, staffUserId: "staffUsers|admin", actorRole: "admin" });
  const ownerId = h.seed(channel === "order" ? "orders" : "posSales", { ...("order" in build ? build.order : build.sale), status: "paid" });
  for (const line of build.lines) h.seed(channel === "order" ? "orderLineItems" : "posSaleLines", { ...line, createdAt: now });
  const owner = h.rows(channel === "order" ? "orders" : "posSales")[0] as Raw;
  const paymentId = channel === "order" ? session : intent;
  h.seed("paymentEvents", { ...ownerKeys, provider: channel === "order" ? "stripe" : "terminal", providerPaymentId: paymentId, providerPaymentIntentId: intent,
    status: "paid", amountCents: owner.totalCents, currency: "usd", rawEventId: "evt_secretpayment1234", raw: { SECRET_RAW: "SECRET_CANARY" }, createdAt: now });
  const bookingId = cafe ? null : h.seed("bookings", { ...ownerKeys, bookingRef, status: "confirmed", partySize: 3, visitDate: "2026-10-02", entryTime: "12:00", createdAt: now, customerEmailLower: "SECRET_EMAIL", ticketCode: "SECRET_TICKET" });
  const exceptionId = h.seed("operationsExceptions", { ...ownerKeys, ...(cafe ? {} : { bookingRef }), category: "ticket_delivery", code: "email_delivery_outcome_unknown", status: "open", moneyReceived: true,
    amountCents: 100, currency: "usd", occurrenceCount: 1, firstSeenAt: now, lastSeenAt: now, createdAt: now, dedupeKey: "SECRET_DEDUPE", evidence: { source: "reconciliation", SECRET_PAYLOAD: "SECRET_CANARY" } });
  const read = async (as = "admin") => parseBillingDetail(await h.call<BillingDetail>(billingDetails.getOperationsExceptionDetail, { exceptionId }, as), { exceptionId });
  const refund = (fields: Record<string, unknown> = {}) => h.seed("refunds", { ...ownerKeys, paymentProvider: channel === "order" ? "stripe" : "terminal", providerRefundId: "re_billingrefund1234", providerPaymentIntentId: intent,
    rawEventId: "evt_secretrefund1234", status: "succeeded", amountCents: 100, currency: "usd", providerEventCreatedAt: now, createdAt: now, updatedAt: now, ...fields });
  const delivery = (fields: Record<string, unknown> = {}) => h.seed("ticketDeliveries", { ...ownerKeys, bookingRef, ticketCode: "SECRET_TICKET", customerEmailLower: "SECRET_EMAIL", status: "sent", sendVersion: 1, attemptCount: 1, sentAt: now - 20000, lastAttemptAt: now - 30000,
    providerMessageId: "msg_secretprovider1234", createdAt: now - 30000, updatedAt: now - 20000, ...fields });
  const snapshot = () => JSON.stringify([...(["orders", "posSales", "bookings", "bookingAdmissions", "paymentEvents", "refunds", "ticketDeliveries", "operationsExceptions", "auditEvents", "checkoutPaymentAttempts", "terminalPaymentAttempts"] as const)].map(table => h.rows(table)));
  return { h, ref, ownerKeys, ownerId, owner, bookingId, exceptionId, read, refund, delivery, snapshot, paymentId };
}
function assertUnchanged(f: ReturnType<typeof fixture>, before: string) { expect(f.snapshot()).toBe(before); expect(f.h.scheduled).toEqual([]); }
const record = (f: ReturnType<typeof fixture>, table: string) => f.h.rows(table)[0] as Raw;
async function errorData(promise: Promise<unknown>) { try { await promise; throw new Error("expected typed failure"); } catch (error) { expect(error).toBeInstanceOf(ConvexError); return (error as ConvexError<string>).data; } }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("fresh read authorization and privacy", () => {
  it.each(["admin", "viewer"])("reads %s with stored role and no writes/provider effects", async role => {
    const f = fixture(); f.delivery(); const before = f.snapshot();
    const fetch = vi.fn(() => { throw new Error("provider forbidden"); }); vi.stubGlobal("fetch", fetch);
    const data = await f.read(role); expect(data.role).toBe(role); expect(data.lookup.exceptionId).toBe(f.exceptionId);
    const raw = JSON.stringify(data);
    for (const secret of ["SECRET_EMAIL", "SECRET_TICKET", "SECRET_CANARY", "SECRET_DEDUPE", "secret@example.com", "msg_secretprovider1234", intent, session, "evt_secretpayment1234"]) expect(raw).not.toContain(secret);
    expect(fetch).not.toHaveBeenCalled(); assertUnchanged(f, before); vi.unstubAllGlobals();
  });
  it.each(["pos", "removed", "inactive"])("denies observed %s before protected selection", async as => {
    const f = fixture(); if (as === "inactive") f.h.seed("staffUsers", { subject: as, role: "admin", active: false });
    const get = vi.spyOn(f.h.ctx.db, "get");
    expect(await errorData(f.read(as))).toEqual({ kind: "billing_read_error", version: 1, code: "billing_access_denied" }); expect(get).not.toHaveBeenCalled();
  });
  it("denies anonymous; duplicate staff/auth/table errors remain unverified", async () => {
    const f = fixture(); expect(await errorData(f.h.call(billingDetails.getOperationsExceptionDetail, { exceptionId: f.exceptionId }))).toMatchObject({ code: "billing_access_denied" });
    f.h.seed("staffUsers", { subject: "admin", role: "viewer", active: true }); expect(await errorData(f.read())).toMatchObject({ code: "billing_read_unverified" });
    vi.spyOn(f.h.ctx.auth, "getUserIdentity").mockRejectedValue(new Error("SECRET_AUTH")); expect(await errorData(f.read())).toEqual({ kind: "billing_read_error", version: 1, code: "billing_read_unverified" });
  });
  it("a borrowed typed-looking transport error cannot attest access denial", async () => {
    const f = fixture(); vi.spyOn(f.h.ctx.auth, "getUserIdentity").mockRejectedValue(new ConvexError({ kind: "billing_read_error", version: 1, code: "billing_access_denied" }));
    expect(await errorData(f.read())).toEqual({ kind: "billing_read_error", version: 1, code: "billing_read_unverified" });
  });
  it("exact absent ID carries only bound safe not-found lookup", async () => {
    const f = fixture(); expect(await errorData(f.h.call(billingDetails.getOperationsExceptionDetail, { exceptionId: "operationsExceptions|missing" }, "viewer"))).toEqual({ kind: "billing_read_error", version: 1, code: "billing_record_not_found", lookup: { exceptionId: "operationsExceptions|missing" } });
  });
  it.each(["pi_a", "re_x", "abcd", "x", "SECRET\nURL", "pi_long1234"])("always masks %s", id => { const masked = maskBillingId(id)!; expect(masked).not.toBe(id); expect(masked).toMatch(/^(?:cs_|pi_|evt_|re_|msg_|id)…[A-Za-z0-9]{0,4}$/); if (id.length <= 8) expect(masked.split("…")[1]).toBe(""); });
  it("unknown freeform facts become finite null/issues, never scalars", async () => {
    const f = fixture(); Object.assign(record(f, "operationsExceptions"), { code: "SECRET_CODE", status: "resolved", resolvedAt: now, resolution: "SECRET_RESOLUTION", evidence: { reason: "SECRET_REASON", source: "SECRET_SOURCE", eventType: "SECRET_EVENT" } });
    const data = await f.read(); expect(data.exception.code).toBeNull(); expect(data.evidence.safeReasonCode).toBeNull(); expect(data.exception.dataIssues).toContain("unrecognized_code"); expect(JSON.stringify(data)).not.toContain("SECRET_");
  });
});

describe("independent bounded recorded money proof", () => {
  it.each(["order", "sale"] as const)("proves canonical all-age %s cart and keeps exception amount independent", async channel => {
    const f = fixture(channel); const data = await f.read(); expect(data.money).toMatchObject({ paidFactRecorded: true, proof: "proven", provenPaidCents: f.owner.totalCents, currency: "usd" });
    expect(data.lines.rows.map(line => line.admissionCategory)).toEqual(["adult", "youth", "child"]); expect(data.lines.rows.reduce((sum, row) => sum + row.quantity!, 0)).toBe(3);
    expect(data.owner!.subtotalCents).toBe(3000); expect(data.exception.amountCents).toBe(100); expect(data.booking!.paidProof).toBe("proven"); expect(data.attendance).toMatchObject({ used: false, admitted: null, departed: null, inside: null, proof: "proven" });
    expect(data.delivery.issuance).toBe("not_found");
  });
  it("150 declines cannot hide exact paid; recent pane is separately capped", async () => {
    const f = fixture(); for (let i = 0; i < 150; i++) f.h.seed("paymentEvents", { ...f.ownerKeys, provider: "stripe", providerPaymentId: session, providerPaymentIntentId: intent, status: "failed", amountCents: f.owner.totalCents, currency: "usd", createdAt: now + i });
    const data = await f.read(); expect(data.money.proof).toBe("proven"); expect(data.recent.payments.rows).toHaveLength(10); expect(data.recent.payments.coverage).toBe("capped");
  });
  it.each(["duplicate", "distinct", "foreign_pending", "foreign_paid", "provider_id_foreign"])("retains paid fact while %s blocks proof", async corruption => {
    const f = fixture(); const paid = record(f, "paymentEvents");
    const { _id, _creationTime, ...copy } = paid;
    f.h.seed("paymentEvents", { ...copy, ...(corruption === "distinct" ? { providerPaymentId: "cs_second", providerPaymentIntentId: "pi_second" } : corruption === "foreign_pending" ? { orderRef: "SKY2610-OTHER1", status: "processing" } : corruption === "foreign_paid" ? { orderRef: "SKY2610-OTHER1" } : corruption === "provider_id_foreign" ? { orderRef: "SKY2610-OTHER1", providerPaymentIntentId: "pi_other" } : {}) });
    const data = await f.read(); expect(data.money).toMatchObject({ paidFactRecorded: true, proof: "conflict", provenPaidCents: null }); expect(data.booking!.paidProof).not.toBe("proven");
  });
  it("Terminal mismatched payment ID cannot prove money", async () => { const f = fixture("sale"); record(f, "paymentEvents").providerPaymentId = "pi_other"; expect((await f.read()).money.proof).toBe("conflict"); });
  it("101 owner paid rows and501 same-status ownership rows classify capped, never zero", async () => {
    const f = fixture(); for (let i = 0; i < 100; i++) f.h.seed("paymentEvents", { ...record(f, "paymentEvents"), providerPaymentIntentId: `pi_extra${i}` });
    const data = await f.read(); expect(data.money).toMatchObject({ paidFactRecorded: true, proof: "unverified", provenPaidCents: null }); expect(data.coverage.paid).toBe("capped");
    const g = fixture(); for (let i = 0; i < 501; i++) g.h.seed("paymentEvents", { ...record(g, "paymentEvents"), status: "failed" });
    const overflow = await g.read(); expect(overflow.money.proof).toBe("unverified"); expect(overflow.coverage.intentOwnership).toBe("capped");
  });
  it("cancelled owner / unusable admission preserve historical proven money", async () => {
    const f = fixture(); f.owner.status = "canceled"; const line = record(f, "orderLineItems"); line.metadata = { SECRET_RAW: "wrong_provenance" }; line.unitAmountCents = 17; line.lineTotalCents = 17;
    const data = await f.read(); expect(data.money.proof).toBe("proven"); expect(data.booking!.paidProof).toBe("blocked"); expect(data.owner!.status).toBe("canceled");
  });
  it("safe individual historical lines with an unsafe/inconsistent aggregate remain unverified independently of money", async () => {
    const f = fixture(); const lines = f.h.rows("orderLineItems");
    for (const line of lines) { line.quantity = 1; line.unitAmountCents = Number.MAX_SAFE_INTEGER; line.lineTotalCents = Number.MAX_SAFE_INTEGER; }
    const data = await f.read(); expect(data.lines.coverage).toBe("unverified"); expect(data.money.proof).toBe("proven");
  });
  it("unsafe/coherently mismatched owner amounts cannot become financial proof", async () => {
    const f = fixture(); f.owner.feeCents = -1; const data = await f.read(); expect(data.money.proof).toBe("conflict"); expect(data.owner!.dataIssues).toContain("invalid_owner_total");
  });
  it("noncanonical owner/booking refs are withheld, but recorded paid/use remains affirmative", async () => {
    const f = fixture(); const legacy = "ADMIT-SECRET"; for (const table of ["orders", "orderLineItems", "bookings", "paymentEvents", "operationsExceptions"]) for (const row of f.h.rows(table)) row.orderRef = legacy;
    const booking = record(f, "bookings"); booking.bookingRef = legacy; booking.checkedInAt = "malformed"; record(f, "operationsExceptions").bookingRef = legacy;
    const data = await f.read(); expect(data.owner!.ref).toBeNull(); expect(data.booking!.bookingRef).toBeNull(); expect(data.money).toMatchObject({ paidFactRecorded: true, proof: "unverified" }); expect(data.attendance).toMatchObject({ used: true, proof: "unverified", inside: null }); expect(JSON.stringify(data)).not.toContain(legacy);
  });
  it("no paid row means none recorded, not no charge; billing exception money fact stays true", async () => { const f = fixture(); f.h.rows("paymentEvents").splice(0); const data = await f.read(); expect(data.money.proof).toBe("none_recorded"); expect(data.exception.moneyReceived).toBe(true); });
  it("duplicate owner is ambiguous; no newest selection or guessed relation", async () => { const f = fixture(); f.h.seed("orders", { ...f.owner }); const data = await f.read(); expect(data.relation.state).toBe("ambiguous"); expect(data.owner).toBeNull(); expect(data.money.proof).toBe("unverified"); });
});

describe("complete positive refunds and historical attendance", () => {
  it.each([0, 100, 3000])( "separates succeeded sum %i from pending/failed events", async cents => {
    const f = fixture("sale"); if (cents) f.refund({ amountCents: cents }); f.refund({ providerRefundId: "re_pending", status: "pending", amountCents: 2999 }); f.refund({ providerRefundId: "re_failed", status: "failed", amountCents: 2999 });
    const data = await f.read(); expect(data.refunds).toMatchObject({ proof: "proven", succeededRefundCents: cents, disposition: cents === 0 ? "none_succeeded_recorded" : cents === 3000 ? "full" : "partial" }); expect(data.money.proof).toBe("proven");
    if (cents === 3000) expect(data.booking!.paidProof).toBe("blocked");
  });
  it.each(["duplicate_global", "foreign_owner", "foreign_provider", "invalid_amount", "excess"])("%s never creates a refund total or booking entitlement", async corruption => {
    const f = fixture(); f.refund(corruption === "foreign_owner" ? { orderRef: "SKY2610-OTHER1" } : corruption === "foreign_provider" ? { paymentProvider: "terminal" } : corruption === "invalid_amount" ? { amountCents: -1 } : corruption === "excess" ? { amountCents: Number(f.owner.totalCents) + 1 } : {});
    if (corruption === "duplicate_global") f.refund({ orderRef: "SKY2610-OTHER1", status: "failed" });
    const data = await f.read(); expect(data.refunds).toMatchObject({ proof: "conflict", succeededRefundCents: null, disposition: "unknown" }); expect(data.money.proof).toBe("proven"); expect(data.booking!.paidProof).not.toBe("proven");
  });
  it("101 succeeded refunds return capped null; no prefix full/zero inference", async () => { const f = fixture(); for (let i = 0; i < 101; i++) f.refund({ providerRefundId: `re_${i}`, amountCents: 1 }); const data = await f.read(); expect(data.refunds.proof).toBe("unverified"); expect(data.coverage.refunds).toBe("capped"); expect(data.refunds.succeededRefundCents).toBeNull(); });
  it("safe running sum prevents overflow", async () => { const f = fixture(); f.owner.subtotalCents = Number.MAX_SAFE_INTEGER; f.owner.feeCents = 0; f.owner.totalCents = Number.MAX_SAFE_INTEGER; record(f, "paymentEvents").amountCents = Number.MAX_SAFE_INTEGER; f.refund({ amountCents: Number.MAX_SAFE_INTEGER - 1 }); f.refund({ providerRefundId: "re_other", amountCents: 2 }); expect((await f.read()).refunds.reasons).toContain("refund_sum_overflow"); });
  it("full refund/cancellation/departure keep immutable used and trusted counts", async () => {
    const f = fixture("sale"); f.refund({ amountCents: 3000 }); Object.assign(record(f, "bookings"), { status: "cancelled", checkedInAt: now - 60000, departedAt: now - 1000, admissionTracked: true });
    f.h.seed("bookingAdmissions", { bookingRef, visitDate: "2026-10-02", partySize: 3, departedCount: 3, inside: false, admittedAt: now - 60000, departedAt: now - 1000, updatedAt: now });
    const before = f.snapshot(); const data = await f.read(); expect(data.attendance).toMatchObject({ used: true, admitted: 3, departed: 3, inside: 0, proof: "proven" }); expect(data.refunds.disposition).toBe("full"); assertUnchanged(f, before);
  });
  it.each(["duplicate", "invalid", "legacy", "contradictory_delivery"])("%s attendance preserves positive use with unknown counts", async corruption => {
    const f = fixture(); const admission = { bookingRef, visitDate: "2026-10-02", partySize: 3, departedCount: 0, inside: true, admittedAt: now - 1000, updatedAt: now };
    if (corruption === "legacy") record(f, "bookings").departedPartySize = "malformed";
    else if (corruption === "contradictory_delivery") { f.delivery({ bookingRef: "SKY2610-OTHER1" }); f.h.seed("bookingAdmissions", { ...admission, bookingRef: "SKY2610-OTHER1" }); }
    else { f.h.seed("bookingAdmissions", { ...admission, ...(corruption === "invalid" ? { departedCount: 99 } : {}) }); if (corruption === "duplicate") f.h.seed("bookingAdmissions", admission); }
    const data = await f.read(); expect(data.attendance).toMatchObject({ used: true, admitted: null, departed: null, inside: null, proof: "unverified" });
  });
  it("malformed tracked-use flag retains possible use; unknown booking state cannot prove unused", async () => {
    const f = fixture(); record(f, "bookings").admissionTracked = "possibly-used";
    expect((await f.read()).attendance).toMatchObject({ used: true, proof: "unverified", inside: null });
    const g = fixture(); record(g, "bookings").status = "unknown-legacy"; expect((await g.read()).attendance).toMatchObject({ used: null, proof: "unverified" });
  });
  it("invalid legacy cafe owner cannot attest no-ticket applicability while retaining recorded money", async () => {
    const f = fixture("sale", true); const legacy = "LEGACY-INVALID-SALE";
    for (const table of ["posSales", "posSaleLines", "paymentEvents", "operationsExceptions"]) for (const row of f.h.rows(table)) row.saleRef = legacy;
    const data = await f.read(); expect(data.owner!.ref).toBeNull(); expect(data.relation.state).toBe("unverified");
    expect(data.money).toMatchObject({ paidFactRecorded: true, proof: "unverified" }); expect(data.delivery.issuance).toBe("unverified"); expect(data.attendance.proof).toBe("unverified");
    expect(JSON.stringify(data)).not.toContain(legacy);
  });
  it("cafe-only sale has independent paid money, no ticket/outbox/admission requirement", async () => { const f = fixture("sale", true); const data = await f.read(); expect(data.money.proof).toBe("proven"); expect(data.booking).toBeNull(); expect(data.delivery.issuance).toBe("not_applicable"); expect(data.attendance.proof).toBe("not_applicable"); });
});

describe("delivery and recorded recovery truth", () => {
  it("acceptance is distinct from delivery and later bounce preserves delivered evidence", async () => {
    const f = fixture(); f.delivery(); const accepted = await f.read(); expect(accepted.delivery).toMatchObject({ acceptance: "recorded", deliveryEvidence: "none_recorded" });
    Object.assign(record(f, "ticketDeliveries"), { deliveredAt: now - 10000, providerDeliveryStatus: "bounced", providerStatusAt: now - 5000 });
    const bounced = await f.read(); expect(bounced.delivery).toMatchObject({ acceptance: "recorded", deliveryEvidence: "recorded", providerDeliveryStatus: "bounced" });
  });
  it("new send version/inconsistent acceptance history stays unverified", async () => { const f = fixture(); f.delivery({ status: "queued", sendVersion: 2, lastAttemptAt: now - 10000 }); expect((await f.read()).delivery.acceptance).toBe("unverified"); });
  it("five-minute sender lease is visible at three minutes, without verified-read claim", async () => { const f = fixture(); f.delivery({ status: "sending", lastAttemptAt: now - 180000, sentAt: undefined, providerMessageId: undefined }); const data = await f.read(); expect(data.recovery.find(row => row.kind === "email_send")).toMatchObject({ schedule: "active_lease", leaseExpiresAt: now + 120000 }); expect(JSON.stringify(data)).not.toContain("verifiedProvider"); });
  it("claim timestamp / overdue schedule are stored intent, never paid proof or worker health", async () => {
    const f = fixture(); f.h.seed("checkoutPaymentAttempts", { orderRef, status: "open", stripeMode: "test", apiVersion: "2026-02-25.clover", providerSessionId: session, providerPaymentIntentId: intent, reconcileAt: now - 1000, lastReconciledAt: now - 2000, reconcileCount: 30, providerRequestCount: 4, createdAt: now, updatedAt: now, requestParams: { SECRET: "SECRET_PARAMS" }, attemptNonce: "SECRET_NONCE" });
    const data = await f.read(); expect(data.recovery[0]).toMatchObject({ correlation: "correlated", schedule: "scheduled", lastReconciliationAttemptAt: now - 2000, reconcileCount: 30 }); expect(JSON.stringify(data)).not.toContain("SECRET");
    record(f, "checkoutPaymentAttempts").reconcileCount = -1; expect((await f.read()).recovery[0].schedule).toBe("unverified");
  });
  it("selected webhook and attempt must corroborate every exact event/session/intent", async () => {
    const f = fixture(); Object.assign(record(f, "operationsExceptions"), { providerEventId: "evt_selected1234", providerSessionId: session, providerPaymentIntentId: intent, evidence: { eventType: "checkout.session.completed" } });
    f.h.seed("checkoutPaymentAttempts", { orderRef, status: "paid", stripeMode: "test", apiVersion: "2026-02-25.clover", providerSessionId: session, providerPaymentIntentId: intent, createdAt: now, updatedAt: now });
    const event = { provider: "stripe", providerEventId: "evt_selected1234", eventType: "checkout.session.completed", orderRef, raw: { eventId: "evt_selected1234", eventType: "checkout.session.completed", session: { id: session, payment_intent: "pi_wrong" } }, createdAt: now };
    f.h.seed("webhookEvents", event); const mismatch = await f.read(); expect(mismatch.coverage.webhook).toBe("unverified"); expect(mismatch.recovery[0].correlation).toBe("unverified"); expect(mismatch.money.proof).toBe("proven");
    (record(f, "webhookEvents").raw as { session: { payment_intent: string } }).session.payment_intent = intent; const exact = await f.read(); expect(exact.coverage.webhook).toBe("complete"); expect(exact.recovery[0].correlation).toBe("correlated");
  });
  it.each(["order", "sale"] as const)("event-only %s exception cannot borrow a different current payment's recovery", async channel => {
    const f = fixture(channel); f.delivery();
    Object.assign(record(f, "operationsExceptions"), { providerEventId: "evt_eventonly1234", evidence: { eventType: channel === "order" ? "checkout.session.completed" : "payment_intent.succeeded" } });
    f.h.seed(channel === "order" ? "checkoutPaymentAttempts" : "terminalPaymentAttempts", { ...f.ownerKeys, status: "paid", stripeMode: "test", apiVersion: "2026-02-25.clover", providerPaymentIntentId: intent, ...(channel === "order" ? { providerSessionId: session } : {}), createdAt: now, updatedAt: now });
    f.h.seed("bookingAdmissions", { bookingRef, visitDate: "2026-10-02", partySize: 3, departedCount: 0, inside: true, admittedAt: now - 1000, updatedAt: now });
    const eventType = channel === "order" ? "checkout.session.completed" : "payment_intent.succeeded";
    f.h.seed("webhookEvents", { ...f.ownerKeys, provider: channel === "order" ? "stripe" : "terminal", providerEventId: "evt_eventonly1234", eventType,
      raw: { eventId: "evt_eventonly1234", eventType, ...(channel === "order" ? { session: { id: "cs_oldpayment", payment_intent: "pi_oldpayment" } } : { paymentIntent: { id: "pi_oldpayment" } }) }, createdAt: now });
    const before = f.snapshot(); const mismatch = await f.read(); expect(mismatch.coverage.webhook).toBe("complete"); expect(mismatch.recovery.every(row => row.correlation === "unverified")).toBe(true);
    expect(mismatch.money.proof).toBe("proven"); expect(mismatch.attendance.used).toBe(true); assertUnchanged(f, before);
    const raw = record(f, "webhookEvents").raw as Record<string, unknown>;
    if (channel === "order") raw.session = { id: session, payment_intent: intent }; else raw.paymentIntent = { id: intent };
    const exact = await f.read(); expect(exact.recovery.every(row => row.correlation === "correlated")).toBe(true); expect(exact.money.proof).toBe("proven"); expect(exact.attendance.used).toBe(true);
    if (channel === "sale") { delete raw.paymentIntent; raw.session = { id: session, payment_intent: intent }; }
    else { delete raw.session; raw.paymentIntent = { id: intent }; }
    const unsupported = await f.read(); expect(unsupported.coverage.webhook).toBe("unverified"); expect(unsupported.recovery.every(row => row.correlation === "unverified")).toBe(true);
  });
  it("event-only refund recovery requires the exact globally proven recorded refund ID", async () => {
    const f = fixture("sale"); f.delivery(); f.refund();
    Object.assign(record(f, "operationsExceptions"), { providerEventId: "evt_refundonly1234", evidence: { eventType: "refund.updated" } });
    f.h.seed("terminalPaymentAttempts", { saleRef, status: "paid", stripeMode: "test", apiVersion: "2026-02-25.clover", providerPaymentIntentId: intent, createdAt: now, updatedAt: now });
    f.h.seed("webhookEvents", { saleRef, provider: "stripe", providerEventId: "evt_refundonly1234", eventType: "refund.updated", raw: { eventId: "evt_refundonly1234", eventType: "refund.updated", refund: { id: "re_unproven", payment_intent: intent } }, createdAt: now });
    const mismatch = await f.read(); expect(mismatch.coverage.webhook).toBe("complete"); expect(mismatch.recovery.every(row => row.correlation === "unverified")).toBe(true); expect(mismatch.money.proof).toBe("proven");
    (record(f, "webhookEvents").raw as { refund: { id: string } }).refund.id = "re_billingrefund1234";
    const exact = await f.read(); expect(exact.recovery.every(row => row.correlation === "correlated")).toBe(true); expect(exact.refunds.succeededRefundCents).toBe(100);
  });
  it("unrecognized API/provider/error strings cannot imply healthy or safe stop", async () => { const f = fixture("sale"); f.h.seed("terminalPaymentAttempts", { saleRef, status: "processing", apiVersion: "SECRET_API", lastProviderState: "SECRET_STATE", lastError: "SECRET_ERROR", exceptionReason: "SECRET_REASON", createdAt: now, updatedAt: now }); const data = await f.read(); expect(data.recovery[0]).toMatchObject({ apiVersion: null, providerState: null, safeStopReasonCode: null, safeLastErrorCode: null, lastErrorRecorded: true, schedule: "unverified" }); expect(JSON.stringify(data)).not.toContain("SECRET_"); });
  it("fixed history panes cannot expose freeform audit/refund fields or unrelated action families", async () => {
    const f = fixture(); for (let i = 0; i < 30; i++) f.h.seed("auditEvents", { action: "pos.terminalPayment.paid", entityType: "order", entityRef: orderRef, metadata: { customerEmail: "SECRET_EMAIL", token: "SECRET_TOKEN", amountCents: 10 }, createdAt: now + i });
    f.refund({ status: "failed", reason: "SECRET_REASON", failureReason: "SECRET_FAILURE" }); const data = await f.read(); expect(data.recent.audit.rows).toHaveLength(25); expect(data.recent.audit.coverage).toBe("capped"); expect(data.recent.audit.rows[0].action).toBeNull(); expect(data.recent.refunds.rows[0]).toMatchObject({ reasonRecorded: true, failureReasonRecorded: true }); expect(JSON.stringify(data)).not.toContain("SECRET_");
  });
  it("explicit maximum reserves7914, and runtime proof uses bounded reads only", async () => {
    const f = fixture(); for (let i = 0; i < 100; i++) f.refund({ providerRefundId: `re_budget_${i}`, amountCents: 1 }); const ctx = f.h.ctx as unknown as QueryCtx; const reservations: number[] = []; const realQuery = ctx.db.query.bind(ctx.db);
    const wrap = (value: unknown): unknown => new Proxy(value as object, { get(target, key) { const item = Reflect.get(target, key); if (key === "collect") return () => { throw new Error("unbounded collection forbidden"); }; if (key === "take") return (count: number) => { reservations.push(count); return item.call(target, count); }; if (key === "first") return () => { reservations.push(1); return item.call(target); }; return typeof item === "function" ? (...args: unknown[]) => { const result = item.apply(target, args); return result && typeof result === "object" && !(result instanceof Promise) ? wrap(result) : result; } : item; } });
    ctx.db.query = ((table: string) => wrap(realQuery(table as never))) as typeof ctx.db.query;
    const data = await readBillingDetail(ctx, record(f, "operationsExceptions") as unknown as Doc<"operationsExceptions">, "admin", now);
    expect(data.booking!.paidProof).toBe("proven"); expect(data.refunds.succeededRefundCents).toBe(100); expect(billingDetailPlannedReads).toBe(7914); expect(reservations.reduce((sum, n) => sum + n, 3)).toBeLessThanOrEqual(7914);
    expect(reservations.filter(n => n === 501)).toHaveLength(14); expect(reservations.every(n => Number.isInteger(n) && n <= 501)).toBe(true);
  });
});
