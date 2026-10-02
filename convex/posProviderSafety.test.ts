import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as admin from "./admin";
import * as admissions from "./admissions";
import { createConvexHarness, createFakeStripeTerminal, type ConvexHarness } from "./convexHarness.testkit";
import * as orderDrafts from "./orderDrafts";
import * as paymentInternals from "./paymentInternals";
import * as payments from "./payments";
import * as posStatus from "./posStatus";
import * as terminalReconciliation from "./terminalReconciliation";
import * as ticketDelivery from "./ticketDelivery";

// Friday 2026-10-02, 12:00 PM in Los Angeles (open 09:00-18:00).
const fridayNoon = Date.parse("2026-10-02T19:00:00.000Z");
const friday = "2026-10-02";
const minute = 60 * 1000;
const reconcileJob = "terminalReconciliation:reconcileTerminalAttempt";

type Row = Record<string, unknown> & { _id: string };
type Sale = { saleRef: string; idempotencyKey: string; totalCents: number };
type ProviderCall = { method: string; path: string; idempotencyKey?: string; body?: string };
type Override = { match: (call: ProviderCall) => boolean; respond: () => Response };

let sequence = 0;
const ticketCode = () => `tkt_${String(++sequence).padStart(32, "0")}`;

/**
 * Shared fake Stripe Terminal plus local one-shot responses for provider
 * shapes the shared fake does not produce (reader 400 timeouts, malformed or
 * mismatched bodies, arbitrary 4xx). Overridden calls are recorded locally.
 */
function setup() {
  const h = createConvexHarness({
    admin,
    admissions,
    orderDrafts,
    paymentInternals,
    payments,
    posStatus,
    terminalReconciliation,
    ticketDelivery
  });
  for (const role of ["admin", "pos", "viewer"] as const) {
    h.seed("staffUsers", { subject: role, emailLower: `${role}@example.com`, role, active: true, createdAt: 1, updatedAt: 1 });
  }
  h.seed("staffUsers", { subject: "pos2", emailLower: "pos2@example.com", role: "pos", active: true, createdAt: 1, updatedAt: 1 });
  h.seed("staffUsers", { subject: "inactive", emailLower: "inactive@example.com", role: "pos", active: false, createdAt: 1, updatedAt: 1 });
  const stripe = createFakeStripeTerminal();
  const overrides: Override[] = [];
  const overridden: ProviderCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const headers = (init.headers ?? {}) as Record<string, string>;
      const call: ProviderCall = {
        method: init.method ?? "GET",
        path: url.pathname.replace(/^\/v1/, ""),
        idempotencyKey: headers["Idempotency-Key"],
        body: init.body ? String(init.body) : undefined
      };
      const index = overrides.findIndex((override) => override.match(call));
      if (index >= 0) {
        const [override] = overrides.splice(index, 1);
        overridden.push(call);
        return override.respond();
      }
      return stripe.fetch(input, init);
    })
  );
  const respondOnce = (match: (call: ProviderCall) => boolean, respond: () => Response) => {
    overrides.push({ match, respond });
  };
  return { h, stripe, respondOnce, overridden };
}

const isCreate = (call: ProviderCall) => call.method === "POST" && call.path === "/payment_intents";
const isReader = (call: ProviderCall) => call.method === "POST" && call.path.startsWith("/terminal/readers/");
const stripeError = (status: number, error: Record<string, unknown>) => () => Response.json({ error }, { status });

async function createSale(h: ConvexHarness, entryTime = "12:30", as = "pos"): Promise<Sale> {
  const idempotencyKey = `pos_safety_${String(++sequence).padStart(6, "0")}`;
  const result = await h.call<{ saleRef: string; totals: { totalCents: number } }>(
    orderDrafts.createPosSaleDraft,
    {
      admission: { packageKey: "general", adults: 1, visitDate: friday, entryTime },
      lines: [],
      customerEmail: "walkup@example.com",
      readerId: "tmr_front123",
      idempotencyKey
    },
    as
  );
  return { saleRef: result.saleRef, idempotencyKey, totalCents: result.totals.totalCents };
}

const start = (h: ConvexHarness, sale: Sale, as = "pos") =>
  h.runAction<{ paymentIntentId: string }>(
    payments.createStripeTerminalPaymentIntent,
    { saleRef: sale.saleRef, idempotencyKey: sale.idempotencyKey },
    as
  );
const sendToReader = (h: ConvexHarness, sale: Sale, as = "pos") =>
  h.runAction<{ paymentIntentId: string; status: string }>(
    payments.processStripeTerminalPaymentIntent,
    { saleRef: sale.saleRef, idempotencyKey: sale.idempotencyKey },
    as
  );
// `as: null` calls without any identity.
const refresh = (h: ConvexHarness, sale: Sale, as: string | null = "pos") =>
  h.runAction<Record<string, unknown>>(payments.refreshStripeTerminalPayment, { saleRef: sale.saleRef }, as ?? undefined);
const saleStatus = (h: ConvexHarness, sale: Sale, as: string | null = "pos") =>
  h.call<Record<string, unknown>>(posStatus.getPosSaleStatus, { saleRef: sale.saleRef }, as ?? undefined);

const attemptFor = (h: ConvexHarness, sale: Sale) =>
  h.rows("terminalPaymentAttempts").find((row) => row.saleRef === sale.saleRef) as Row;
const saleRow = (h: ConvexHarness, sale: Sale) => h.rows("posSales").find((row) => row.saleRef === sale.saleRef) as Row;
const holdFor = (h: ConvexHarness, sale: Sale) =>
  h.rows("capacityReservations").find((row) => row.saleRef === sale.saleRef) as Row | undefined;

function paidWebhook(h: ConvexHarness, attempt: Row) {
  return h.call<{ status: string }>(paymentInternals.recordStripeTerminalWebhook, {
    providerEventId: `evt_safety_${++sequence}`,
    eventType: "payment_intent.succeeded",
    outcome: "paid",
    providerPaymentId: attempt.providerPaymentIntentId,
    saleRef: attempt.saleRef,
    ticketCode: ticketCode(),
    amountCents: attempt.amountCents,
    amountReceivedCents: attempt.amountCents,
    currency: "usd",
    attemptNonce: attempt.attemptNonce,
    intentSource: "convex-terminal",
    livemode: false,
    intentStatus: "succeeded",
    providerEventCreatedAt: Date.now()
  });
}

function refundWebhook(h: ConvexHarness, attempt: Row, refundStatus: string, amountCents: number, providerRefundId = `re_safety_${++sequence}`) {
  return h.call<{ status: string }>(paymentInternals.recordStripeRefundWebhook, {
    providerEventId: `evt_refund_${++sequence}`,
    eventType: "refund.updated",
    outcome: "refund",
    providerRefundId,
    providerPaymentIntentId: attempt.providerPaymentIntentId,
    refundStatus,
    amountCents,
    currency: "usd",
    providerEventCreatedAt: Date.now()
  });
}

function seedRefund(h: ConvexHarness, sale: Sale, fields: Record<string, unknown>) {
  h.seed("refunds", {
    providerRefundId: `re_seed_${++sequence}`,
    providerPaymentIntentId: attemptFor(h, sale).providerPaymentIntentId,
    paymentProvider: "terminal",
    saleRef: sale.saleRef,
    status: "succeeded",
    amountCents: sale.totalCents,
    currency: "usd",
    providerEventCreatedAt: 1,
    rawEventId: `evt_seed_${sequence}`,
    createdAt: 1,
    updatedAt: 1,
    ...fields
  });
}

async function paidSale(h: ConvexHarness, entryTime = "12:30") {
  const sale = await createSale(h, entryTime);
  await start(h, sale);
  await expect(paidWebhook(h, attemptFor(h, sale))).resolves.toMatchObject({ status: "processed" });
  return sale;
}

const notRefundedOrClosed = (state: unknown) => expect(["refunded", "canceled", "closed", "draft"]).not.toContain(state);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(fridayNoon);
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_terminal_fixture");
  vi.stubEnv("SKYLA_STRIPE_MODE", "test");
  vi.stubEnv("SKYLA_POS_TERMINAL_ACCEPTANCE", "enabled");
  vi.stubEnv("SKYLA_TERMINAL_READER_REGISTRY", "tmr_front123@tml_front123");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POS sale ownership for status and Refresh", () => {
  it("lets the owner and an admin read and refresh, and refuses another cashier before any bearer field or provider work", async () => {
    const { h, stripe } = setup();
    const sale = await paidSale(h);
    const before = structuredClone(attemptFor(h, sale));
    const callsBefore = stripe.calls.length;

    await expect(saleStatus(h, sale, "pos2")).rejects.toThrow("different staff user");
    await expect(refresh(h, sale, "pos2")).rejects.toThrow("different staff user");
    expect(stripe.calls).toHaveLength(callsBefore);
    expect(attemptFor(h, sale)).toEqual(before);

    const owner = await saleStatus(h, sale, "pos");
    expect(owner).toMatchObject({ paymentState: "paid" });
    expect(owner.ticketCode).toEqual(expect.any(String));
    await expect(saleStatus(h, sale, "admin")).resolves.toMatchObject({ paymentState: "paid", ticketCode: owner.ticketCode });
    await expect(refresh(h, sale, "admin")).resolves.toMatchObject({ paymentState: "paid" });
  });

  it("keeps viewers, inactive and anonymous callers out", async () => {
    const { h, stripe } = setup();
    const sale = await createSale(h);
    await start(h, sale);
    const callsBefore = stripe.calls.length;
    for (const as of ["viewer", "inactive"]) {
      await expect(saleStatus(h, sale, as)).rejects.toThrow("Staff role");
      await expect(refresh(h, sale, as)).rejects.toThrow("Staff role");
    }
    await expect(saleStatus(h, sale, null)).rejects.toThrow("Staff authentication");
    await expect(refresh(h, sale, null)).rejects.toThrow("Staff authentication");
    expect(stripe.calls).toHaveLength(callsBefore);
  });

  it("leaves scheduled reconciliation of another cashier's sale unaffected", async () => {
    const { h, stripe } = setup();
    const sale = await createSale(h);
    const { paymentIntentId } = await start(h, sale);
    stripe.pay(paymentIntentId);
    vi.setSystemTime(fridayNoon + 3 * minute);
    await h.runDueJobs((job) => job.name === reconcileJob);
    expect(saleRow(h, sale).status).toBe("paid");
    await expect(saleStatus(h, sale, "pos")).resolves.toMatchObject({ paymentState: "paid" });
  });
});

describe("ambiguous reader handoffs", () => {
  it.each([
    ["a terminal_reader_timeout 400", stripeError(400, { type: "invalid_request_error", code: "terminal_reader_timeout" })],
    ["an offline reader 400", stripeError(400, { type: "invalid_request_error", code: "terminal_reader_offline" })],
    ["an unrecognized 4xx", stripeError(404, { type: "invalid_request_error", code: "resource_missing" })],
    ["a malformed 5xx", () => new Response("upstream reset", { status: 502 })],
    ["a malformed 200", () => new Response("not json", { status: 200 })],
    [
      "a 200 for another intent",
      () => Response.json({
        id: "tmr_front123", object: "terminal.reader", status: "online",
        action: { type: "process_payment_intent", status: "in_progress", process_payment_intent: { payment_intent: "pi_someoneelse123" } }
      })
    ],
    [
      "a 200 for another reader",
      () => Response.json({ id: "tmr_other999", object: "terminal.reader", status: "online", action: { type: "process_payment_intent", status: "in_progress" } })
    ]
  ])("records %s as unknown, keeps the hold and retries the same intent only after a provider read", async (_label, respond) => {
    const { h, stripe, respondOnce, overridden } = setup();
    const sale = await createSale(h);
    const { paymentIntentId } = await start(h, sale);
    respondOnce(isReader, respond);

    await expect(sendToReader(h, sale)).rejects.toThrow("payment_outcome_unknown");
    expect(String(attemptFor(h, sale).lastReaderStatus)).toMatch(/^unknown:/);
    expect(saleRow(h, sale).status).toBe("payment_pending");
    expect(holdFor(h, sale)!.status).toBe("payment_pending");
    // A reader acknowledgement or error is not money either way.
    const status = await saleStatus(h, sale);
    expect(status).toMatchObject({ paymentState: "awaiting_payment", ticketIssued: false, admissionUsed: false });
    expect(status.ticketCode).toBeUndefined();

    const reads = stripe.retrieveCalls().length;
    await expect(sendToReader(h, sale)).resolves.toMatchObject({ paymentIntentId, status: "processing" });
    expect(stripe.retrieveCalls()).toHaveLength(reads + 1);
    const handoffs = [...overridden.filter(isReader), ...stripe.readerCalls()];
    expect(handoffs.map((call) => new URLSearchParams(call.body).get("payment_intent"))).toEqual([paymentIntentId, paymentIntentId]);
    expect(new Set(handoffs.map((call) => call.idempotencyKey)).size).toBe(2);
    expect(stripe.createCalls()).toHaveLength(1);
    expect(stripe.intents.size).toBe(1);
  });

  it("treats a network timeout as unknown and never re-presents an intent that is no longer waiting for a card", async () => {
    const { h, stripe } = setup();
    const sale = await createSale(h);
    const { paymentIntentId } = await start(h, sale);
    stripe.fail("reader_timeout");
    await expect(sendToReader(h, sale)).rejects.toThrow("payment_outcome_unknown");

    // The card was in fact taken: the retry read sees it and stops.
    stripe.pay(paymentIntentId);
    const handoffs = stripe.readerCalls().length;
    await expect(sendToReader(h, sale)).rejects.toThrow("refresh_required");
    expect(stripe.readerCalls()).toHaveLength(handoffs);
    // The reader path never settles money; only Refresh does.
    expect(saleRow(h, sale).status).toBe("payment_pending");
    await expect(refresh(h, sale)).resolves.toMatchObject({ paymentState: "paid" });
  });

  it("keeps a definite reader refusal a reader error without releasing the payment or hold", async () => {
    const { h, respondOnce } = setup();
    const sale = await createSale(h);
    await start(h, sale);
    respondOnce(isReader, stripeError(400, { type: "invalid_request_error", code: "terminal_reader_busy" }));
    await expect(sendToReader(h, sale)).rejects.toThrow("reader_failed");
    expect(attemptFor(h, sale)).toMatchObject({ status: "open", lastReaderStatus: "failed:stripe_http_400_terminal_reader_busy" });
    expect(saleRow(h, sale).status).toBe("payment_pending");
    expect(holdFor(h, sale)!.status).toBe("payment_pending");
  });
});

describe("Terminal create rejection classification", () => {
  it.each([
    ["a card_error 402", stripeError(402, { type: "card_error", code: "card_declined" })],
    ["an unrecognized 400 code", stripeError(400, { type: "invalid_request_error", code: "something_new" })],
    ["a blank-code 400 validation error", stripeError(400, { type: "invalid_request_error", code: "" })],
    ["a whitespace-code 400 validation error", stripeError(400, { type: "invalid_request_error", code: " " })],
    ["a blank-code 401 authentication error", stripeError(401, { type: "authentication_error", code: "" })],
    ["an unrecognized 400 type", stripeError(400, { type: "brand_new_error" })],
    ["a 404", stripeError(404, { type: "invalid_request_error" })],
    ["an idempotency key in use 409", stripeError(409, { type: "invalid_request_error", code: "idempotency_key_in_use" })],
    ["a 429", stripeError(429, { type: "rate_limit_error" })],
    ["a malformed 400", () => Response.json({ error: "bad" }, { status: 400 })],
    ["an empty 400", () => new Response("", { status: 400 })],
    ["an idempotency conflict", stripeError(400, { type: "idempotency_error" })]
  ])("never closes the sale or releases the hold on %s", async (_label, respond) => {
    const { h, respondOnce } = setup();
    const sale = await createSale(h);
    respondOnce(isCreate, respond);

    await expect(start(h, sale)).rejects.toThrow();
    expect(attemptFor(h, sale).status).not.toBe("rejected");
    expect(saleRow(h, sale).status).toBe("payment_pending");
    expect(holdFor(h, sale)!.status).toBe("payment_pending");
    expect(await saleStatus(h, sale)).toMatchObject({ paymentState: "unknown", readerRetryAllowed: false });
  });

  it("keeps the hold when a deterministic rejection follows an unknown create", async () => {
    const { h, stripe, respondOnce, overridden } = setup();
    const sale = await createSale(h);
    stripe.fail("network_before_send");
    await expect(start(h, sale)).rejects.toThrow("payment_outcome_unknown");
    respondOnce(isCreate, stripeError(400, { type: "invalid_request_error", code: "parameter_missing" }));

    await expect(start(h, sale)).rejects.toThrow("payment_needs_attention");
    const creates = [...stripe.createCalls(), ...overridden.filter(isCreate)];
    expect(creates).toHaveLength(2);
    expect(new Set(creates.map((call) => `${call.idempotencyKey}|${call.body}`)).size).toBe(1);
    expect(attemptFor(h, sale).status).toBe("exception");
    expect(saleRow(h, sale).status).toBe("payment_pending");
    expect(holdFor(h, sale)!.status).toBe("payment_pending");
    expect(await saleStatus(h, sale)).toMatchObject({ paymentState: "unknown" });
  });

  it.each([
    ["a 400 validation error", stripeError(400, { type: "invalid_request_error", code: "parameter_missing" })],
    ["a 401 authentication error", stripeError(401, { type: "authentication_error" })]
  ])("closes safely when %s refused the only create request", async (_label, respond) => {
    const { h, stripe, respondOnce } = setup();
    const sale = await createSale(h);
    respondOnce(isCreate, respond);
    await expect(start(h, sale)).rejects.toThrow("rejected");
    expect(attemptFor(h, sale).status).toBe("rejected");
    expect(saleRow(h, sale).status).toBe("canceled");
    expect(holdFor(h, sale)).toMatchObject({ status: "released", releaseReason: "stripe_terminal_creation_rejected" });
    expect(await saleStatus(h, sale)).toMatchObject({ paymentState: "closed", ticketIssued: false });
    await expect(start(h, sale)).rejects.toThrow("payment_closed");
    expect(stripe.intents.size).toBe(0);
  });
});

describe("refund proof", () => {
  it("shows refunded only for correlated succeeded refunds totaling the payment", async () => {
    const { h } = setup();
    const sale = await paidSale(h);
    const attempt = attemptFor(h, sale);
    await refundWebhook(h, attempt, "succeeded", 1000);
    const partial = await saleStatus(h, sale);
    expect(partial).toMatchObject({ paymentState: "paid_needs_attention", ticketIssued: true });
    expect(partial.ticketCode).toBeUndefined();

    await refundWebhook(h, attempt, "succeeded", sale.totalCents - 1000);
    const refunded = await saleStatus(h, sale);
    expect(refunded).toMatchObject({ status: "canceled", paymentState: "refunded", ticketIssued: true, admissionUsed: false });
    expect(refunded.ticketCode).toBeUndefined();
  });

  it.each(["pending", "requires_action"])("keeps a %s full refund as needing attention", async (refundStatus) => {
    const { h } = setup();
    const sale = await paidSale(h);
    await refundWebhook(h, attemptFor(h, sale), refundStatus, sale.totalCents);
    const status = await saleStatus(h, sale);
    expect(status.paymentState).toBe("paid_needs_attention");
    expect(status.ticketCode).toBeUndefined();
  });

  it("keeps a failed refund as paid money, never refunded", async () => {
    const { h } = setup();
    const sale = await paidSale(h);
    await refundWebhook(h, attemptFor(h, sale), "failed", sale.totalCents);
    expect(await saleStatus(h, sale)).toMatchObject({ paymentState: "paid" });
  });

  it("never shows a canceled sale with received money and no refund as closed, canceled or refunded", async () => {
    const { h } = setup();
    const sale = await paidSale(h);
    Object.assign(saleRow(h, sale), { status: "canceled" });
    const status = await saleStatus(h, sale);
    expect(status.paymentState).toBe("paid_needs_attention");
    expect(status.ticketCode).toBeUndefined();
  });

  it.each([
    ["another intent", { providerPaymentIntentId: "pi_another000001" }],
    ["another currency", { currency: "eur" }],
    ["another sale", { saleRef: "POS-SOMEONE-ELSE" }],
    ["a checkout order", { orderRef: "SKY2610-ORDER" }],
    ["a checkout provider", { paymentProvider: "stripe" }]
  ])("does not accept a full succeeded refund for %s as proof", async (_label, fields) => {
    const { h } = setup();
    const sale = await paidSale(h);
    Object.assign(saleRow(h, sale), { status: "canceled" });
    seedRefund(h, sale, fields);
    const status = await saleStatus(h, sale);
    expect(status.paymentState).toBe("paid_needs_attention");
    expect(status.ticketCode).toBeUndefined();
  });

  it("does not treat an unbounded refund history or a legacy paid record as proof", async () => {
    const { h } = setup();
    const sale = await paidSale(h);
    Object.assign(saleRow(h, sale), { status: "canceled" });
    for (let index = 0; index < 101; index += 1) seedRefund(h, sale, { status: "failed", amountCents: 1 });
    seedRefund(h, sale, {});
    expect((await saleStatus(h, sale)).paymentState).toBe("paid_needs_attention");

    const legacy = await createSale(h, "13:00");
    Object.assign(saleRow(h, legacy), { status: "canceled" });
    h.seed("paymentEvents", {
      saleRef: legacy.saleRef, provider: "terminal", providerPaymentId: "pi_legacy00000001", status: "paid",
      currency: "usd", amountCents: legacy.totalCents, createdAt: 1
    });
    h.seed("refunds", {
      providerRefundId: "re_legacy", providerPaymentIntentId: "pi_legacy00000001", paymentProvider: "terminal",
      saleRef: legacy.saleRef, status: "succeeded", amountCents: legacy.totalCents, currency: "usd",
      providerEventCreatedAt: 1, rawEventId: "evt_legacy", createdAt: 1, updatedAt: 1
    });
    expect((await saleStatus(h, legacy)).paymentState).toBe("paid_needs_attention");
  });
});

describe("issued and used tickets", () => {
  it("keeps money paid after admission and departure while never re-offering a used bearer code", async () => {
    const { h } = setup();
    const sale = await paidSale(h, "12:00");
    const issued = await saleStatus(h, sale);
    expect(issued).toMatchObject({
      paymentState: "paid", bookingStatus: "confirmed", ticketIssued: true, admissionUsed: false, visitDate: friday, entryTime: "12:00"
    });
    expect(issued.ticketCode).toEqual(h.rows("ticketDeliveries")[0].ticketCode);

    await expect(h.call(admin.updateBookingStatus, { bookingRef: sale.saleRef, status: "checked-in" }, "pos"))
      .resolves.toMatchObject({ admissionOutcome: "admitted" });
    const admitted = await saleStatus(h, sale);
    expect(admitted).toMatchObject({ paymentState: "paid", bookingStatus: "checked-in", ticketIssued: true, admissionUsed: true });
    expect(admitted.ticketCode).toBeUndefined();

    await h.call(admissions.recordDeparture, { bookingRef: sale.saleRef, departedCount: 1 }, "pos");
    const departed = await saleStatus(h, sale);
    expect(departed).toMatchObject({ paymentState: "paid", admissionUsed: true });
    expect(departed.ticketCode).toBeUndefined();

    await refundWebhook(h, attemptFor(h, sale), "succeeded", sale.totalCents);
    const refunded = await saleStatus(h, sale);
    expect(refunded).toMatchObject({ paymentState: "refunded", admissionUsed: true, ticketIssued: true });
    expect(refunded.ticketCode).toBeUndefined();
  });

  it("suppresses the bearer code while billing is unresolved", async () => {
    const { h } = setup();
    const sale = await paidSale(h);
    h.seed("operationsExceptions", {
      dedupeKey: "billing:safety:sale", category: "billing", code: "duplicate_payment_for_sale", status: "open", moneyReceived: true,
      saleRef: sale.saleRef, occurrenceCount: 1, firstSeenAt: 1, lastSeenAt: 1, createdAt: 1, updatedAt: 1
    });
    const status = await saleStatus(h, sale);
    expect(status).toMatchObject({ paymentState: "paid_needs_attention", ticketIssued: true });
    expect(status.ticketCode).toBeUndefined();
  });
});

const bookingFor = (h: ConvexHarness, sale: Sale) => h.rows("bookings").find((row) => row.saleRef === sale.saleRef) as Row;
const deliveryFor = (h: ConvexHarness, sale: Sale) =>
  h.rows("ticketDeliveries").find((row) => row.saleRef === sale.saleRef) as Row;

function seedPayment(h: ConvexHarness, intentId: unknown, fields: Record<string, unknown>) {
  h.seed("paymentEvents", {
    provider: "terminal", providerPaymentId: String(intentId), providerPaymentIntentId: intentId,
    currency: "usd", amountCents: 3000, createdAt: Date.now(), ...fields
  });
}

async function expectAttentionWithoutBearer(h: ConvexHarness, sale: Sale) {
  const status = await saleStatus(h, sale);
  expect(status.paymentState).toBe("paid_needs_attention");
  expect(status.ticketCode).toBeUndefined();
  return status;
}

describe("global PaymentIntent ownership", () => {
  it.each([
    ["a foreign checkout order's paid row", { provider: "stripe", orderRef: "SKY2610-FOREIGN", status: "paid" }],
    ["another POS sale's paid row", { saleRef: "POS-FOREIGN-PAID", status: "paid" }],
    ["another POS sale's pending row", { saleRef: "POS-FOREIGN-PENDING", status: "processing" }],
    ["a foreign order's pending row", { provider: "stripe", orderRef: "SKY2610-PENDING", status: "requires_payment" }],
    ["a row owned by both this sale and an order", { status: "failed", orderRef: "SKY2610-BOTH", saleRefSelf: true }]
  ])("never proves paid, refunded or a bearer code when %s shares the intent", async (_label, fields) => {
    const { h } = setup();
    const sale = await paidSale(h);
    const { saleRefSelf, ...row } = fields as Record<string, unknown>;
    seedPayment(h, attemptFor(h, sale).providerPaymentIntentId, { ...(saleRefSelf ? { saleRef: sale.saleRef } : {}), ...row });
    await expectAttentionWithoutBearer(h, sale);

    await refundWebhook(h, attemptFor(h, sale), "succeeded", sale.totalCents);
    const status = await expectAttentionWithoutBearer(h, sale);
    notRefundedOrClosed(status.paymentState);
  });

  it("finds a foreign owner behind more than 100 owned declines, and allows long fully owned decline history", async () => {
    const { h } = setup();
    const owned = await paidSale(h);
    const ownedIntent = attemptFor(h, owned).providerPaymentIntentId;
    for (let index = 0; index < 150; index += 1) seedPayment(h, ownedIntent, { saleRef: owned.saleRef, status: "failed" });
    const clean = await saleStatus(h, owned);
    expect(clean.paymentState).toBe("paid");
    expect(clean.ticketCode).toEqual(expect.any(String));

    seedPayment(h, ownedIntent, { saleRef: "POS-FOREIGN-LATE", status: "failed" });
    await expectAttentionWithoutBearer(h, owned);
  });
});

describe("booking and money provenance", () => {
  it.each([
    ["party size", { partySize: 2 }],
    ["visit date", { visitDate: "2026-10-03" }],
    ["entry time", { entryTime: "13:00" }],
    ["an order owner", { orderRef: "SKY2610-OTHER" }]
  ])("holds attention without a bearer when the booking's %s disagrees with the sale", async (_label, fields) => {
    const { h } = setup();
    const sale = await paidSale(h);
    Object.assign(bookingFor(h, sale), fields);
    await expectAttentionWithoutBearer(h, sale);
  });

  it.each([
    ["a fee that breaks the grand total", (sale: Row) => ({ feeCents: Number(sale.feeCents) + 1 })],
    ["a subtotal that disagrees with its lines", (sale: Row) => ({ subtotalCents: Number(sale.subtotalCents) - 1, feeCents: Number(sale.feeCents) + 1 })],
    ["a fractional fee", (sale: Row) => ({ feeCents: Number(sale.feeCents) + 0.5, subtotalCents: Number(sale.subtotalCents) - 0.5 })],
    ["a negative fee", (sale: Row) => ({ feeCents: -1, subtotalCents: Number(sale.subtotalCents) + 1 + Number(sale.feeCents) })]
  ])("holds attention without a bearer for %s", async (_label, patch) => {
    const { h } = setup();
    const sale = await paidSale(h);
    Object.assign(saleRow(h, sale), patch(saleRow(h, sale)));
    await expectAttentionWithoutBearer(h, sale);
  });

  it("validates cafe-only stored totals instead of trusting one matching paid row", async () => {
    const { h } = setup();
    const idempotencyKey = `pos_safety_${String(++sequence).padStart(6, "0")}`;
    const created = await h.call<{ saleRef: string; totals: { totalCents: number } }>(
      orderDrafts.createPosSaleDraft,
      { lines: [{ kind: "cafe", itemKey: "b1", quantity: 2 }], customerEmail: "walkup@example.com", readerId: "tmr_front123", idempotencyKey },
      "pos"
    );
    const sale = { saleRef: created.saleRef, idempotencyKey, totalCents: created.totals.totalCents };
    await start(h, sale);
    await paidWebhook(h, attemptFor(h, sale));
    const paid = await saleStatus(h, sale);
    expect(paid).toMatchObject({ paymentState: "paid", ticketIssued: false, admissionUsed: false });
    expect(paid.ticketCode).toBeUndefined();

    const row = saleRow(h, sale);
    Object.assign(row, { subtotalCents: Number(row.subtotalCents) + 1, feeCents: Number(row.feeCents) - 1 });
    expect((await saleStatus(h, sale)).paymentState).toBe("paid_needs_attention");
  });

  it.each([
    ["another booking", { bookingRef: "POS-SOMEONE-ELSE" }],
    ["a checkout order", { orderRef: "SKY2610-ORDER" }]
  ])("keeps financial paid but offers no bearer when the delivery belongs to %s", async (_label, fields) => {
    const { h } = setup();
    const sale = await paidSale(h);
    Object.assign(deliveryFor(h, sale), fields);
    const status = await saleStatus(h, sale);
    expect(status).toMatchObject({ paymentState: "paid", ticketIssued: true });
    expect(status.ticketCode).toBeUndefined();
  });

  it("does not accept this sale's paid row when it also names a checkout order", async () => {
    const { h } = setup();
    const sale = await paidSale(h);
    Object.assign(h.rows("paymentEvents").find((row) => row.saleRef === sale.saleRef && row.status === "paid")!, { orderRef: "SKY2610-X" });
    await expectAttentionWithoutBearer(h, sale);
  });

  it("keeps an admitted, fully proven booking financially paid with no bearer", async () => {
    const { h } = setup();
    const sale = await paidSale(h, "12:00");
    await h.call(admin.updateBookingStatus, { bookingRef: sale.saleRef, status: "checked-in" }, "pos");
    const status = await saleStatus(h, sale);
    expect(status).toMatchObject({ paymentState: "paid", admissionUsed: true, ticketIssued: true });
    expect(status.ticketCode).toBeUndefined();
  });
});

describe("duplicate booking evidence", () => {
  const duplicate = (h: ConvexHarness, sale: Sale, fields: Record<string, unknown> = {}) => {
    const { _id, ...original } = bookingFor(h, sale);
    void _id;
    h.seed("bookings", { ...original, bookingRef: `${sale.saleRef}-DUP`, status: "confirmed", ...fields });
  };

  it("never exposes a bearer for two clean bookings, and never reports them as used", async () => {
    const { h } = setup();
    const sale = await paidSale(h);
    duplicate(h, sale);
    const status = await expectAttentionWithoutBearer(h, sale);
    expect(status).toMatchObject({ ticketIssued: true, admissionUsed: false });
  });

  it("keeps durable use visible when the duplicate is the checked-in one", async () => {
    const { h } = setup();
    const sale = await paidSale(h);
    duplicate(h, sale, { status: "checked-in", checkedInAt: Date.now(), admittedPartySize: 1 });
    const status = await expectAttentionWithoutBearer(h, sale);
    expect(status).toMatchObject({ ticketIssued: true, admissionUsed: true });
  });

  it("keeps an audited, fully departed admission visible after a clean duplicate appears", async () => {
    const { h } = setup();
    const sale = await paidSale(h, "12:00");
    await h.call(admin.updateBookingStatus, { bookingRef: sale.saleRef, status: "checked-in" }, "pos");
    await h.call(admissions.recordDeparture, { bookingRef: sale.saleRef, departedCount: 1 }, "pos");
    // Even with the original's own markers cleared, the immutable admission row proves use.
    Object.assign(bookingFor(h, sale), {
      status: "confirmed", checkedInAt: undefined, admissionTracked: undefined, admittedPartySize: undefined,
      departedPartySize: undefined, departedAt: undefined
    });
    duplicate(h, sale);
    const status = await expectAttentionWithoutBearer(h, sale);
    expect(status).toMatchObject({ ticketIssued: true, admissionUsed: true });
  });
});

describe("refund proof uniqueness", () => {
  it("never counts duplicate rows of one provider refund as two refunds", async () => {
    const { h } = setup();
    const sale = await paidSale(h);
    Object.assign(saleRow(h, sale), { status: "canceled" });
    const half = sale.totalCents / 2;
    expect(Number.isInteger(half)).toBe(true);
    seedRefund(h, sale, { providerRefundId: "re_dup_one", amountCents: half });
    seedRefund(h, sale, { providerRefundId: "re_dup_one", amountCents: half, rawEventId: "evt_dup_two" });
    await expectAttentionWithoutBearer(h, sale);
  });

  it("does not accept a refund without a provider refund id", async () => {
    const { h } = setup();
    const sale = await paidSale(h);
    Object.assign(saleRow(h, sale), { status: "canceled" });
    seedRefund(h, sale, { providerRefundId: " " });
    await expectAttentionWithoutBearer(h, sale);
  });

  it("still accepts distinct refunds that total the payment", async () => {
    const { h } = setup();
    const sale = await paidSale(h);
    Object.assign(saleRow(h, sale), { status: "canceled" });
    seedRefund(h, sale, { providerRefundId: "re_part_one", amountCents: 1000 });
    seedRefund(h, sale, { providerRefundId: "re_part_two", amountCents: sale.totalCents - 1000 });
    expect((await saleStatus(h, sale)).paymentState).toBe("refunded");
  });
});

describe("reader auth refusal shapes", () => {
  it.each([
    ["a 401 with an unrecognized error type", stripeError(401, { type: "brand_new_error" })],
    ["a 403 with an api_error type", stripeError(403, { type: "api_error" })],
    ["a 401 card_error", stripeError(401, { type: "card_error" })],
    ["a blank-code 401 authentication_error", stripeError(401, { type: "authentication_error", code: "" })],
    ["a blank-code 400 reader error", stripeError(400, { type: "invalid_request_error", code: "" })]
  ])("keeps %s unknown so the same intent is only retried after Refresh", async (_label, respond) => {
    const { h, stripe, respondOnce } = setup();
    const sale = await createSale(h);
    await start(h, sale);
    respondOnce(isReader, respond);
    await expect(sendToReader(h, sale)).rejects.toThrow("payment_outcome_unknown");
    expect(String(attemptFor(h, sale).lastReaderStatus)).toMatch(/^unknown:/);
    expect(holdFor(h, sale)!.status).toBe("payment_pending");
    expect(stripe.createCalls()).toHaveLength(1);
    expect(stripe.intents.size).toBe(1);
  });

  it.each([
    ["a 401 authentication_error", stripeError(401, { type: "authentication_error" })],
    ["a 403 permission_error", stripeError(403, { type: "permission_error" })]
  ])("treats %s as a definite reader refusal", async (_label, respond) => {
    const { h, respondOnce } = setup();
    const sale = await createSale(h);
    await start(h, sale);
    respondOnce(isReader, respond);
    await expect(sendToReader(h, sale)).rejects.toThrow("reader_failed");
    expect(String(attemptFor(h, sale).lastReaderStatus)).toMatch(/^failed:/);
    expect(holdFor(h, sale)!.status).toBe("payment_pending");
  });
});

describe("bounded payment history", () => {
  const seedHistory = (h: ConvexHarness, sale: Sale, count: number, status: string) => {
    for (let index = 0; index < count; index += 1) {
      h.seed("paymentEvents", {
        saleRef: sale.saleRef, provider: "terminal", providerPaymentId: String(attemptFor(h, sale).providerPaymentIntentId),
        providerPaymentIntentId: attemptFor(h, sale).providerPaymentIntentId, status, currency: "usd",
        amountCents: sale.totalCents, createdAt: Date.now() + index, _creationTime: Date.now() + index
      });
    }
  };

  it("finds paid money behind more than 100 declines and reports the latest status honestly", async () => {
    const { h } = setup();
    const sale = await createSale(h);
    await start(h, sale);
    // Declines recorded before the payment push it past any first-100 read.
    seedHistory(h, sale, 150, "failed");
    vi.setSystemTime(fridayNoon + minute);
    await paidWebhook(h, attemptFor(h, sale));
    const paid = await saleStatus(h, sale);
    expect(paid).toMatchObject({ paymentState: "paid", paymentStatus: "paid" });

    vi.setSystemTime(fridayNoon + 2 * minute);
    seedHistory(h, sale, 120, "requires_payment");
    expect(await saleStatus(h, sale)).toMatchObject({ paymentState: "paid", paymentStatus: "requires_payment" });
  });

  it("never turns a canceled sale with long history and received money into refunded or closed", async () => {
    const { h } = setup();
    const sale = await paidSale(h);
    vi.setSystemTime(fridayNoon + minute);
    seedHistory(h, sale, 150, "failed");
    Object.assign(saleRow(h, sale), { status: "canceled" });
    const status = await saleStatus(h, sale);
    notRefundedOrClosed(status.paymentState);
    expect(status.paymentState).toBe("paid_needs_attention");
    expect(status.paymentStatus).toBe("failed");
  });
});
