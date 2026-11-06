import {
  currentLiabilityWaiverVersion,
  currentTermsVersion
} from "@skyla/payments";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as checkoutReconciliation from "./checkoutReconciliation";
import * as checkoutStatus from "./checkoutStatus";
import { createConvexHarness, createFakeStripe, type ConvexHarness } from "./convexHarness.testkit";
import { checkoutCreateReplayWindowMs, checkoutSessionLifetimeMs } from "./lib/checkoutAttempts";
import { stripeCheckoutOutcomeFromEvent } from "./lib/stripeWebhook";
import * as operationsExceptions from "./operationsExceptions";
import * as orderDrafts from "./orderDrafts";
import * as paymentInternals from "./paymentInternals";
import * as payments from "./payments";
import * as ticketDelivery from "./ticketDelivery";

declare const process: { env: Record<string, string | undefined> };

// Friday 2026-10-02, 12:00 PM in Los Angeles; Saturday is open 10:00-22:00.
const fridayNoon = Date.parse("2026-10-02T19:00:00.000Z");
const visitDate = "2026-10-03";
const minute = 60 * 1000;
const reconcileJob = "checkoutReconciliation:reconcileCheckoutAttempt";

type Draft = { orderRef: string; idempotencyKey: string };
type Row = Record<string, unknown>;

let sequence = 0;
const hexKey = () => (++sequence).toString(16).padStart(64, "0");

function setup(options: { livemode?: boolean } = {}) {
  const harness = createConvexHarness({
    orderDrafts,
    payments,
    paymentInternals,
    checkoutReconciliation,
    checkoutStatus,
    ticketDelivery,
    operationsExceptions
  });
  const stripe = createFakeStripe(options);
  const fetchMock = vi.fn(stripe.fetch);
  vi.stubGlobal("fetch", fetchMock);
  return { harness, stripe, fetchMock };
}

async function createDraft(harness: ConvexHarness, overrides: Record<string, unknown> = {}): Promise<Draft> {
  const idempotencyKey = `checkout_recon_${String(++sequence).padStart(5, "0")}`;
  const draft = await harness.call<{ orderRef: string }>(orderDrafts.createCheckoutOrderDraft, {
    gatewayRateLimitKey: hexKey(),
    packageKey: "general",
    adults: 2,
    visitDate,
    entryTime: "14:00",
    customerEmail: "guest@example.com",
    idempotencyKey,
    ...overrides
  });
  return { orderRef: draft.orderRef, idempotencyKey };
}

function startPayment(harness: ConvexHarness, draft: Draft) {
  return harness.runAction<{ checkoutSessionId: string; url: string; amountCents: number; expiresAt: number }>(
    payments.createStripeCheckoutSession,
    {
      gatewayRateLimitKey: hexKey(),
      orderRef: draft.orderRef,
      idempotencyKey: draft.idempotencyKey,
      legalAcceptance: {
        termsAccepted: true,
        termsVersion: currentTermsVersion,
        liabilityWaiverAccepted: true,
        liabilityWaiverVersion: currentLiabilityWaiverVersion
      },
      successUrl: "https://skydeckla.com/checkout?stripe=success&session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: "https://skydeckla.com/checkout?stripe=cancel"
    }
  );
}

function webhook(harness: ConvexHarness, args: Record<string, unknown>) {
  return harness.call<{ status: string; duplicate: boolean }>(paymentInternals.recordStripeCheckoutWebhook, args);
}

function paidWebhookArgs(attempt: Row, overrides: Record<string, unknown> = {}) {
  return {
    providerEventId: `evt_paid_${++sequence}`,
    eventType: "checkout.session.completed",
    outcome: "paid",
    providerPaymentId: attempt.providerSessionId,
    providerPaymentIntentId: "pi_checkout_paid_1",
    orderRef: attempt.orderRef,
    ticketCode: `tkt_${String(++sequence).padStart(32, "0")}`,
    amountCents: attempt.amountCents,
    currency: "usd",
    attemptNonce: attempt.attemptNonce,
    sessionMode: "payment",
    livemode: false,
    sessionStatus: "complete",
    paymentStatus: "paid",
    providerEventCreatedAt: Date.now(),
    ...overrides
  };
}

const attemptRow = (harness: ConvexHarness) => harness.rows("checkoutPaymentAttempts")[0];
const orderRow = (harness: ConvexHarness) => harness.rows("orders")[0];
const holdRow = (harness: ConvexHarness) => harness.rows("capacityReservations")[0];
const paidEvents = (harness: ConvexHarness) => harness.rows("paymentEvents").filter((event) => event.status === "paid");
const openExceptions = (harness: ConvexHarness) =>
  harness.rows("operationsExceptions").filter((row) => row.status === "open");
const params = (attempt: Row) =>
  Object.fromEntries((attempt.requestParams as Array<{ name: string; value: string }>).map((entry) => [entry.name, entry.value]));

function runReconcileJobs(harness: ConvexHarness) {
  return harness.runDueJobs((job) => job.name === reconcileJob);
}

/** Forces the stored attempt due now, as a lost-schedule sweep would find it. */
function makeDue(harness: ConvexHarness) {
  attemptRow(harness).reconcileAt = Date.now();
  return harness.runAction(checkoutReconciliation.reconcileCheckoutAttempt, { attemptId: attemptRow(harness)._id });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(fridayNoon);
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_reconciliation_fixture");
  process.env.SKYLA_STRIPE_MODE = "test";
  process.env.SKYLA_PAYMENT_RETURN_ORIGINS = "https://skydeckla.com";
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.SKYLA_STRIPE_MODE;
  delete process.env.SKYLA_PAYMENT_RETURN_ORIGINS;
});

describe("frozen checkout attempts", () => {
  it.each(["customer", "scheduled"])("never POSTs into changed same-mode provider credentials during %s recovery", async (path) => {
    const { harness, stripe } = setup();
    const draft = await createDraft(harness);
    stripe.fail("network_after_create");
    await expect(startPayment(harness, draft)).rejects.toThrow("did not confirm");
    vi.setSystemTime(fridayNoon + 3 * minute);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_different_merchant_fixture");
    if (path === "customer") await expect(startPayment(harness, draft)).rejects.toThrow("payment_needs_attention");
    else await runReconcileJobs(harness);
    expect(stripe.createCalls()).toHaveLength(1);
    expect(attemptRow(harness)).toMatchObject({ status: "exception", lastError: "provider_configuration_changed" });
    expect(holdRow(harness).status).toBe("payment_pending");
    expect(String(attemptRow(harness).providerConfigurationFingerprint)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("a delayed original request cannot begin payment after atomic draft abandonment", async () => {
    const { harness, stripe } = setup();
    const draft = await createDraft(harness);
    await harness.call(orderDrafts.releaseCheckoutOrderDraft, { ...draft, gatewayRateLimitKey: hexKey() });
    await expect(startPayment(harness, draft)).rejects.toThrow("payment_session_closed");
    expect(stripe.calls).toHaveLength(0);
    expect(holdRow(harness).status).toBe("released");
  });
  it("stores the exact request, key and 45-minute expiry before the network call, then reuses the one Session", async () => {
    const { harness, stripe, fetchMock } = setup();
    const draft = await createDraft(harness);
    let atNetworkTime: { attempts: Row[]; order: unknown; hold: unknown } | undefined;
    fetchMock.mockImplementation(async (url, init) => {
      atNetworkTime ??= {
        attempts: structuredClone(harness.rows("checkoutPaymentAttempts")),
        order: orderRow(harness).status,
        hold: holdRow(harness).status
      };
      return stripe.fetch(url, init);
    });

    const started = await startPayment(harness, draft);

    expect(atNetworkTime).toMatchObject({ order: "payment_pending", hold: "payment_pending" });
    expect(atNetworkTime!.attempts).toEqual([expect.objectContaining({ status: "creating", providerRequestCount: 1 })]);
    const attempt = attemptRow(harness);
    const expiresAt = fridayNoon + checkoutSessionLifetimeMs;
    expect(attempt).toMatchObject({ status: "open", expiresAt, reconcileAt: expiresAt + 2 * minute, stripeMode: "test" });
    expect(params(attempt)).toMatchObject({
      mode: "payment",
      "payment_method_types[0]": "card",
      expires_at: String(Math.floor(expiresAt / 1000)),
      client_reference_id: draft.orderRef,
      "metadata[order_ref]": draft.orderRef,
      "metadata[attempt_nonce]": attempt.attemptNonce
    });
    const [create] = stripe.createCalls();
    expect(create.idempotencyKey).toBe(attempt.providerIdempotencyKey);
    expect(create.idempotencyKey).toBe(`skyla:checkout-session:v2:${draft.orderRef}:${attempt.attemptNonce}`);
    expect(create.body).toBe(
      new URLSearchParams((attempt.requestParams as Array<{ name: string; value: string }>).map((p) => [p.name, p.value])).toString()
    );
    expect(started).toMatchObject({
      checkoutSessionId: attempt.providerSessionId,
      url: `https://checkout.stripe.com/c/pay/${attempt.providerSessionId}`,
      amountCents: 4000,
      expiresAt
    });

    // Reload, double click or Stripe "back": the same Session, no new request.
    vi.setSystemTime(fridayNoon + 10 * minute);
    await expect(startPayment(harness, draft)).resolves.toMatchObject({ checkoutSessionId: started.checkoutSessionId });
    expect(stripe.createCalls()).toHaveLength(1);
    expect(stripe.sessions.size).toBe(1);
    expect(harness.rows("paymentEvents").filter((event) => event.status === "created")).toHaveLength(1);
  });

  it("lets concurrent starts for one order create at most one provider Session", async () => {
    const { harness, stripe } = setup();
    const draft = await createDraft(harness);

    const outcomes = await Promise.allSettled([startPayment(harness, draft), startPayment(harness, draft)]);

    expect(harness.rows("checkoutPaymentAttempts")).toHaveLength(1);
    expect(stripe.createCalls()).toHaveLength(1);
    expect(stripe.sessions.size).toBe(1);
    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") expect(String(outcome.reason)).toContain("payment_in_progress");
    }
  });

  it("keeps the hold on an unknown creation outcome and replays the identical request with the same key", async () => {
    const { harness, stripe } = setup();
    const draft = await createDraft(harness);
    stripe.fail("network_after_create");

    await expect(startPayment(harness, draft)).rejects.toThrow("did not confirm the payment page");

    expect(attemptRow(harness)).toMatchObject({ status: "creation_unknown", lastError: "network_error" });
    expect(orderRow(harness).status).toBe("payment_pending");
    expect(holdRow(harness).status).toBe("payment_pending");
    const frozenExpiry = attemptRow(harness).expiresAt;

    vi.setSystemTime(fridayNoon + 2 * minute);
    const resumed = await startPayment(harness, draft);

    const [first, replay] = stripe.createCalls();
    expect(replay.body).toBe(first.body);
    expect(replay.idempotencyKey).toBe(first.idempotencyKey);
    expect(stripe.sessions.size).toBe(1);
    expect(resumed.checkoutSessionId).toBe([...stripe.sessions.keys()][0]);
    expect(attemptRow(harness)).toMatchObject({ status: "open", expiresAt: frozenExpiry, providerRequestCount: 2 });
  });

  it("replays from the safety-net schedule when the gateway action died after the request", async () => {
    const { harness, stripe } = setup();
    const draft = await createDraft(harness);
    stripe.fail("network_before_send");
    await expect(startPayment(harness, draft)).rejects.toThrow("did not confirm");

    vi.setSystemTime(fridayNoon + 3 * minute);
    await runReconcileJobs(harness);

    expect(stripe.createCalls()).toHaveLength(2);
    expect(stripe.sessions.size).toBe(1);
    expect(attemptRow(harness).status).toBe("open");
  });

  it("never replays after the safe window: a stored 500 becomes a visible exception and the hold stays", async () => {
    const { harness, stripe } = setup();
    const draft = await createDraft(harness);
    stripe.fail("stored_500");
    await expect(startPayment(harness, draft)).rejects.toThrow("did not confirm");

    vi.setSystemTime(fridayNoon + minute);
    await expect(startPayment(harness, draft)).rejects.toThrow("did not confirm");
    expect(stripe.createCalls()).toHaveLength(2);

    vi.setSystemTime(fridayNoon + checkoutCreateReplayWindowMs + minute);
    await expect(startPayment(harness, draft)).rejects.toThrow("payment_needs_attention");
    expect(stripe.createCalls()).toHaveLength(2);
    expect(attemptRow(harness)).toMatchObject({
      status: "exception",
      exceptionReason: "checkout_session_creation_outcome_unknown"
    });
    expect(holdRow(harness).status).toBe("payment_pending");
    expect(openExceptions(harness)).toEqual([
      expect.objectContaining({ category: "checkout_attempt", code: "checkout_session_creation_outcome_unknown", moneyReceived: false })
    ]);

    // Well past Stripe's 24-hour key retention: still no replay, no release,
    // and no daily reset of the occupancy.
    vi.setSystemTime(fridayNoon + 25 * 60 * minute);
    await harness.call(checkoutReconciliation.sweepCheckoutAttempts, {});
    await runReconcileJobs(harness);
    expect(stripe.createCalls()).toHaveLength(2);
    expect(holdRow(harness).status).toBe("payment_pending");
  });

  it("releases the hold only when Stripe definitively rejected the only request ever sent", async () => {
    const { harness, stripe } = setup();
    const draft = await createDraft(harness);
    stripe.fail("invalid_request");

    await expect(startPayment(harness, draft)).rejects.toThrow("rejected the payment request");

    expect(attemptRow(harness).status).toBe("rejected");
    expect(params(attemptRow(harness)).customer_email).toBe("[redacted]");
    expect(orderRow(harness).status).toBe("canceled");
    expect(holdRow(harness)).toMatchObject({ status: "released", releaseReason: "stripe_creation_rejected" });
    expect(openExceptions(harness)).toEqual([
      expect.objectContaining({ code: "checkout_session_creation_rejected", moneyReceived: false })
    ]);
    await expect(startPayment(harness, draft)).rejects.toThrow("payment_session_closed");
  });

  it("stops before payment_pending when configuration is missing", async () => {
    const { harness, stripe } = setup();
    const draft = await createDraft(harness);
    delete process.env.STRIPE_SECRET_KEY;

    await expect(startPayment(harness, draft)).rejects.toThrow("STRIPE_SECRET_KEY is not configured");

    expect(harness.rows("checkoutPaymentAttempts")).toHaveLength(0);
    expect(orderRow(harness).status).toBe("draft");
    expect(holdRow(harness).status).toBe("draft");
    expect(stripe.calls).toHaveLength(0);
  });

  it.each([
    ["a missing Session mode", (s: Row) => ({ ...s, mode: undefined }), "session_mode_missing"],
    ["a non-payment Session mode", (s: Row) => ({ ...s, mode: "subscription" }), "session_mode_invalid"],
    ["a missing livemode flag", (s: Row) => ({ ...s, livemode: undefined }), "session_livemode_missing"],
    ["a live Session in test mode", (s: Row) => ({ ...s, livemode: true }), "session_livemode_mismatch"],
    ["a different amount", (s: Row) => ({ ...s, amount_total: 1 }), "session_amount_mismatch"],
    ["a different currency", (s: Row) => ({ ...s, currency: "eur" }), "session_currency_mismatch"],
    ["another order", (s: Row) => ({ ...s, client_reference_id: "ORD-OTHER" }), "session_order_mismatch"],
    [
      "another attempt nonce",
      (s: Row) => ({ ...s, metadata: { ...(s.metadata as Row), attempt_nonce: "f".repeat(32) } }),
      "session_attempt_nonce_mismatch"
    ],
    ["a recalculated expiry", (s: Row) => ({ ...s, expires_at: (s.expires_at as number) + 60 }), "session_expiry_mismatch"]
  ])("rejects a created Session with %s and never hands its URL to the guest", async (_label, tamper, reason) => {
    const { harness, stripe } = setup();
    const draft = await createDraft(harness);
    stripe.tamperCreatedSession(tamper);

    await expect(startPayment(harness, draft)).rejects.toThrow("payment_needs_attention");

    expect(attemptRow(harness)).toMatchObject({ status: "exception", exceptionReason: "checkout_session_creation_mismatch" });
    expect(attemptRow(harness).providerSessionUrl).toBeUndefined();
    expect(holdRow(harness).status).toBe("payment_pending");
    expect(openExceptions(harness)[0]).toMatchObject({ evidence: expect.objectContaining({ reason }) });
  });
});

describe("independent paid evidence invariants", () => {
  it.each(["sessionMode", "livemode", "sessionStatus", "paymentStatus"])("missing modern %s cannot issue a ticket", async (field) => {
    const { harness } = setup();
    const draft = await createDraft(harness);
    await startPayment(harness, draft);
    await webhook(harness, paidWebhookArgs(attemptRow(harness), { [field]: undefined }));
    expect(harness.rows("bookings")).toHaveLength(0);
    expect(harness.rows("ticketDeliveries")).toHaveLength(0);
    expect(holdRow(harness).status).toBe("payment_pending");
    expect(openExceptions(harness)[0].moneyReceived).toBe(true);
  });

  it("one paid PaymentIntent cannot fund a second order and ticket", async () => {
    const { harness } = setup();
    const first = await createDraft(harness);
    await startPayment(harness, first);
    await webhook(harness, paidWebhookArgs(attemptRow(harness)));
    const second = await createDraft(harness);
    await startPayment(harness, second);
    await webhook(harness, paidWebhookArgs(harness.rows("checkoutPaymentAttempts")[1]));
    expect(paidEvents(harness)).toHaveLength(1);
    expect(harness.rows("bookings")).toHaveLength(1);
    expect(harness.rows("ticketDeliveries")).toHaveLength(1);
    expect(openExceptions(harness)[0]).toMatchObject({ code: "paid_payment_identity_reused", orderRef: second.orderRef });
  });

  it("an invalid existing delivery preserves paid money without creating a booking", async () => {
    const { harness } = setup();
    const draft = await createDraft(harness);
    await startPayment(harness, draft);
    harness.seed("ticketDeliveries", { bookingRef: draft.orderRef, orderRef: draft.orderRef,
      emailLower: "different@example.com", ticketCode: "tkt_0123456789abcdef0123456789abcdef" });
    await webhook(harness, paidWebhookArgs(attemptRow(harness)));
    expect(paidEvents(harness)).toHaveLength(1);
    expect(orderRow(harness).status).toBe("paid");
    expect(harness.rows("bookings")).toHaveLength(0);
    expect(openExceptions(harness)[0]).toMatchObject({ code: "paid_ticket_delivery_invalid", moneyReceived: true });
  });
});

describe("signed webhook strictness", () => {
  async function openSession() {
    const context = setup();
    const draft = await createDraft(context.harness);
    await startPayment(context.harness, draft);
    return { ...context, draft, attempt: attemptRow(context.harness) };
  }

  it.each([
    ["a missing Session mode", { sessionMode: "missing" }, "paid_session_mode_invalid"],
    ["a setup-mode Session", { sessionMode: "setup" }, "paid_session_mode_invalid"],
    ["a live event for a test attempt", { livemode: true }, "paid_session_livemode_mismatch"],
    ["a different amount", { amountCents: 1 }, "amount_or_currency_mismatch"],
    ["a missing amount", { amountCents: undefined }, "amount_or_currency_mismatch"],
    ["a missing currency", { currency: undefined }, "amount_or_currency_mismatch"],
    ["another attempt nonce", { attemptNonce: "e".repeat(32) }, "attempt_nonce_mismatch"],
    ["a missing attempt nonce", { attemptNonce: undefined }, "attempt_nonce_missing"],
    [
      "a Session Convex never created",
      { providerPaymentId: "cs_test_unknownsession0001", attemptNonce: undefined },
      "payment_session_not_created_by_convex"
    ],
    ["another Session carrying this attempt's nonce", { providerPaymentId: "cs_test_othersession00001" }, "attempt_session_mismatch"],
    ["a missing PaymentIntent", { providerPaymentIntentId: undefined }, "missing_checkout_payment_intent"]
  ])("records %s as a billing exception without a ticket or a release", async (_label, overrides, code) => {
    const { harness, attempt } = await openSession();

    const result = await webhook(harness, paidWebhookArgs(attempt, overrides));

    expect(result.status).toBe("failed");
    expect(harness.rows("bookings")).toHaveLength(0);
    expect(harness.rows("ticketDeliveries")).toHaveLength(0);
    expect(paidEvents(harness)).toHaveLength(0);
    expect(holdRow(harness).status).toBe("payment_pending");
    expect(openExceptions(harness)).toEqual([
      expect.objectContaining({ category: "billing", code, moneyReceived: true })
    ]);
  });

  it("passes paid Sessions with missing money fields on instead of silently ignoring them", () => {
    const outcome = stripeCheckoutOutcomeFromEvent({
      id: "evt_paid_missing_fields",
      type: "checkout.session.completed",
      created: 1_790_000_000,
      livemode: false,
      data: {
        object: {
          id: "cs_test_missingfields0001",
          object: "checkout.session",
          client_reference_id: "ORD-1",
          payment_status: "paid",
          status: "complete",
          metadata: { order_ref: "ORD-1", attempt_nonce: "a".repeat(32) }
        }
      }
    });
    expect(outcome).toMatchObject({
      outcome: "paid",
      sessionMode: "missing",
      attemptNonce: "a".repeat(32),
      providerEventCreatedAt: 1_790_000_000_000
    });
    expect(outcome.outcome === "paid" && outcome.amountCents).toBeUndefined();
  });

  it("correlates a lost-response Session by its attempt nonce and fulfills it once", async () => {
    const { harness, stripe } = setup();
    const draft = await createDraft(harness);
    stripe.fail("network_after_create");
    await expect(startPayment(harness, draft)).rejects.toThrow("did not confirm");
    const sessionId = [...stripe.sessions.keys()][0];
    const attempt = attemptRow(harness);
    expect(attempt.providerSessionId).toBeUndefined();

    const result = await webhook(harness, paidWebhookArgs({ ...attempt, providerSessionId: sessionId }));

    expect(result.status).toBe("processed");
    expect(attemptRow(harness)).toMatchObject({ status: "paid", providerSessionId: sessionId });
    expect(harness.rows("bookings")).toHaveLength(1);
    // The guest's retry now learns that payment was received; no new Session.
    await expect(startPayment(harness, draft)).rejects.toThrow("payment_already_received");
    expect(stripe.createCalls()).toHaveLength(1);
  });
});

describe("autonomous reconciliation of known Sessions", () => {
  async function openSession() {
    const context = setup();
    const draft = await createDraft(context.harness);
    const started = await startPayment(context.harness, draft);
    return { ...context, draft, sessionId: started.checkoutSessionId };
  }

  it("leaves an open Session alone and checks again just after its frozen expiry", async () => {
    const { harness, stripe } = await openSession();

    await makeDue(harness);

    expect(stripe.retrieveCalls()).toHaveLength(1);
    expect(attemptRow(harness)).toMatchObject({
      status: "open",
      lastProviderState: "open",
      reconcileAt: (attemptRow(harness).expiresAt as number) + 2 * minute
    });
    expect(holdRow(harness).status).toBe("payment_pending");
    expect(stripe.calls.some((call) => call.path.endsWith("/expire"))).toBe(false);
  });

  it("keeps the hold while Stripe still reports a Session open after expiry, and backs off", async () => {
    const { harness } = await openSession();
    const expiresAt = attemptRow(harness).expiresAt as number;
    vi.setSystemTime(expiresAt + 2 * minute);

    await runReconcileJobs(harness);

    expect(holdRow(harness).status).toBe("payment_pending");
    expect(attemptRow(harness).reconcileAt).toBe(expiresAt + 2 * minute + 30 * 1000);
  });

  it("releases only a correlated expired and unpaid Session", async () => {
    const { harness, stripe, sessionId } = await openSession();
    stripe.expire(sessionId);
    vi.setSystemTime((attemptRow(harness).expiresAt as number) + 2 * minute);

    await runReconcileJobs(harness);

    expect(orderRow(harness).status).toBe("expired");
    expect(holdRow(harness)).toMatchObject({ status: "released", releaseReason: "stripe:session_expired_reconciled" });
    expect(attemptRow(harness).status).toBe("expired");
    expect(params(attemptRow(harness)).customer_email).toBe("[redacted]");
  });

  it("does not release a complete-but-unpaid Session", async () => {
    const { harness, stripe, sessionId } = await openSession();
    Object.assign(stripe.session(sessionId), { status: "complete", payment_status: "unpaid" });

    await makeDue(harness);

    expect(holdRow(harness).status).toBe("payment_pending");
    expect(attemptRow(harness)).toMatchObject({ status: "open", lastProviderState: "complete_unpaid" });
  });

  it("fulfills a paid Session found by reconciliation exactly once, even when webhooks arrive later", async () => {
    const { harness, stripe, sessionId } = await openSession();
    const paymentIntentId = stripe.pay(sessionId);

    await makeDue(harness);
    const attempt = attemptRow(harness);
    await webhook(harness, paidWebhookArgs(attempt, { providerPaymentIntentId: paymentIntentId }));
    await webhook(harness, paidWebhookArgs(attempt, {
      providerPaymentIntentId: paymentIntentId,
      eventType: "checkout.session.async_payment_succeeded"
    }));

    expect(attempt.status).toBe("paid");
    expect(paidEvents(harness)).toHaveLength(1);
    expect(harness.rows("bookings")).toHaveLength(1);
    expect(harness.rows("ticketDeliveries")).toHaveLength(1);
    expect(holdRow(harness).status).toBe("paid");
    expect(harness.scheduled.filter((job) => job.name === "ticketDelivery:sendTicketConfirmation")).toHaveLength(1);
  });

  it("treats provider errors as unknown, backs off, and surfaces exhaustion without guessing", async () => {
    const { harness, stripe } = await openSession();
    stripe.fail("server_error");

    await makeDue(harness);
    expect(attemptRow(harness)).toMatchObject({ status: "open", lastProviderState: "unknown", lastError: "stripe_http_500" });
    expect(attemptRow(harness).reconcileAt).toBe(Date.now() + 30 * 1000);

    attemptRow(harness).reconcileCount = 30;
    stripe.fail("server_error");
    await makeDue(harness);
    expect(attemptRow(harness)).toMatchObject({ status: "exception", exceptionReason: "checkout_reconciliation_exhausted_unknown" });
    expect(holdRow(harness).status).toBe("payment_pending");
  });

  it("makes a missing secret a visible configuration state with bounded backoff, then recovers", async () => {
    const { harness, stripe } = await openSession();
    delete process.env.STRIPE_SECRET_KEY;

    await makeDue(harness);

    expect(stripe.retrieveCalls()).toHaveLength(0);
    expect(openExceptions(harness)).toEqual([
      expect.objectContaining({ code: "checkout_reconciliation_unconfigured", moneyReceived: false })
    ]);
    expect(attemptRow(harness).reconcileAt).toBe(Date.now() + 15 * minute);
    expect(holdRow(harness).status).toBe("payment_pending");

    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_reconciliation_fixture");
    vi.setSystemTime(Date.now() + 15 * minute);
    await runReconcileJobs(harness);
    expect(stripe.retrieveCalls()).toHaveLength(1);
    expect(harness.rows("operationsExceptions")[0]).toMatchObject({ status: "resolved", resolution: "configuration_restored" });
  });

  it("refuses to read a test Session with a live key", async () => {
    const { harness, stripe } = await openSession();
    process.env.SKYLA_STRIPE_MODE = "live";
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_other_account");

    await makeDue(harness);

    expect(stripe.retrieveCalls()).toHaveLength(0);
    expect(attemptRow(harness).lastError).toBe("SKYLA_STRIPE_MODE does not match the stored checkout attempt");
  });

  it("lets only one of two overlapping workers reach the provider", async () => {
    const { harness, stripe } = await openSession();
    attemptRow(harness).reconcileAt = Date.now();
    const attemptId = attemptRow(harness)._id;

    await Promise.all([
      harness.runAction(checkoutReconciliation.reconcileCheckoutAttempt, { attemptId }),
      harness.runAction(checkoutReconciliation.reconcileCheckoutAttempt, { attemptId })
    ]);

    expect(stripe.retrieveCalls()).toHaveLength(1);
  });

  it("discards a slow worker's result after a webhook settled the attempt or another worker took over", async () => {
    const { harness, sessionId } = await openSession();
    const attemptId = attemptRow(harness)._id;
    attemptRow(harness).reconcileAt = Date.now();
    const slow = await harness.call<{ attempt: { version: number } }>(
      checkoutReconciliation.claimCheckoutAttemptReconciliation,
      { attemptId, leaseToken: "slow-worker" }
    );

    // The lease expires; a second worker takes over and a signed expiry wins.
    vi.setSystemTime(Date.now() + 3 * minute);
    attemptRow(harness).reconcileAt = Date.now();
    const second = await harness.call<{ attempt: { version: number } }>(
      checkoutReconciliation.claimCheckoutAttemptReconciliation,
      { attemptId, leaseToken: "second-worker" }
    );
    expect(second).not.toBeNull();
    await webhook(harness, {
      providerEventId: "evt_expired_first",
      eventType: "checkout.session.expired",
      outcome: "canceled",
      providerPaymentId: sessionId,
      orderRef: attemptRow(harness).orderRef,
      attemptNonce: attemptRow(harness).attemptNonce,
      sessionMode: "payment",
      livemode: false,
      sessionStatus: "expired",
      paymentStatus: "unpaid"
    });

    for (const [leaseToken, claim] of [["slow-worker", slow], ["second-worker", second]] as const) {
      await expect(
        harness.call(checkoutReconciliation.recordCheckoutReconciliationResult, {
          attemptId,
          leaseToken,
          version: claim.attempt.version,
          result: {
            state: "paid",
            providerPaymentIntentId: "pi_stale",
            livemode: false,
            ticketCode: "tkt_99999999999999999999999999999999"
          }
        })
      ).resolves.toEqual({ applied: false });
    }
    expect(harness.rows("bookings")).toHaveLength(0);
    expect(paidEvents(harness)).toHaveLength(0);
    expect(holdRow(harness).status).toBe("released");
  });

  it("finds a lost scheduled reconciliation with the bounded sweep", async () => {
    const { harness, stripe, sessionId } = await openSession();
    stripe.expire(sessionId);
    harness.scheduled.length = 0;
    vi.setSystemTime((attemptRow(harness).expiresAt as number) + 3 * minute);

    await expect(harness.call(checkoutReconciliation.sweepCheckoutAttempts, {})).resolves.toEqual({ scheduled: 1 });
    await runReconcileJobs(harness);

    expect(holdRow(harness).status).toBe("released");
  });
});

describe("paid fulfillment timing and billing exceptions", () => {
  // Saturday 2026-10-03 in Los Angeles (PDT, UTC-7).
  const la = (time: string, date = "2026-10-03") => {
    const [hour, min] = time.split(":").map(Number);
    return Date.parse(`${date}T00:00:00.000Z`) + ((hour + 7) * 60 + min) * minute;
  };

  async function lateEveningOrder(options: { close?: string } = {}) {
    vi.setSystemTime(la(options.close ? "20:20" : "20:00"));
    const context = setup();
    if (options.close) {
      context.harness.seed("config", {
        key: "hours",
        data: {
          Monday: { open: "09:00", close: "18:00", closed: false },
          Tuesday: { open: "09:00", close: "18:00", closed: false },
          Wednesday: { open: "09:00", close: "18:00", closed: false },
          Thursday: { open: "09:00", close: "18:00", closed: false },
          Friday: { open: "09:00", close: "18:00", closed: false },
          Saturday: { open: "10:00", close: options.close, closed: false },
          Sunday: { open: "10:00", close: "22:00", closed: false }
        },
        updatedAt: 1
      });
    }
    const draft = await createDraft(context.harness, { entryTime: "20:30" });
    await startPayment(context.harness, draft);
    return { ...context, attempt: attemptRow(context.harness) };
  }

  it("fulfills a same-day payment after the entry time while the venue is still open", async () => {
    const { harness, attempt } = await lateEveningOrder();
    vi.setSystemTime(la("21:55"));

    const result = await webhook(harness, paidWebhookArgs(attempt, { providerEventCreatedAt: la("20:40") }));

    expect(result.status).toBe("processed");
    expect(harness.rows("bookings")[0]).toMatchObject({ visitDate, entryTime: "20:30", status: "confirmed" });
  });

  it.each([
    ["after closing the same day", la("22:30")],
    ["on the next LA day", la("10:00", "2026-10-04")]
  ])("records a payment made before closing but processed %s as an exception with no ticket", async (_label, processedAt) => {
    const { harness, attempt } = await lateEveningOrder();
    vi.setSystemTime(processedAt);

    const result = await webhook(harness, paidWebhookArgs(attempt, { providerEventCreatedAt: la("20:40") }));

    expect(result.status).toBe("failed");
    expect(harness.rows("bookings")).toHaveLength(0);
    expect(harness.rows("ticketDeliveries")).toHaveLength(0);
    expect(orderRow(harness).status).toBe("paid");
    expect(paidEvents(harness)).toHaveLength(1);
    expect(holdRow(harness).status).toBe("exception");
    expect(openExceptions(harness)).toEqual([
      expect.objectContaining({ code: "paid_fulfillment_after_visit_window", moneyReceived: true })
    ]);
  });

  it("never manufactures admission for a payment made after the selected window closed", async () => {
    const { harness, attempt } = await lateEveningOrder({ close: "21:00" });
    vi.setSystemTime(la("21:03"));

    const result = await webhook(harness, paidWebhookArgs(attempt, { providerEventCreatedAt: la("21:02") }));

    expect(result.status).toBe("failed");
    expect(harness.rows("bookings")).toHaveLength(0);
    expect(paidEvents(harness)).toHaveLength(1);
    expect(openExceptions(harness)[0]).toMatchObject({ code: "paid_after_visit_window", moneyReceived: true });
  });

  it("records a paid event that arrives after a correlated expiry released the hold, and re-counts the party", async () => {
    const context = setup();
    const draft = await createDraft(context.harness);
    await startPayment(context.harness, draft);
    const attempt = attemptRow(context.harness);
    await webhook(context.harness, {
      providerEventId: "evt_expired_before_paid",
      eventType: "checkout.session.expired",
      outcome: "canceled",
      providerPaymentId: attempt.providerSessionId,
      orderRef: attempt.orderRef,
      attemptNonce: attempt.attemptNonce,
      sessionMode: "payment",
      livemode: false,
      sessionStatus: "expired",
      paymentStatus: "unpaid"
    });
    expect(holdRow(context.harness).status).toBe("released");

    const result = await webhook(context.harness, paidWebhookArgs(attemptRow(context.harness)));

    expect(result.status).toBe("failed");
    expect(orderRow(context.harness).status).toBe("paid");
    expect(paidEvents(context.harness)).toHaveLength(1);
    expect(holdRow(context.harness)).toMatchObject({ status: "exception", exceptionReason: "paid_unfulfilled:paid_after_order_closed" });
    expect(context.harness.rows("bookings")).toHaveLength(0);
    expect(openExceptions(context.harness)[0]).toMatchObject({ code: "paid_after_order_closed", moneyReceived: true });
  });

  it("dedupes repeated and differently identified paid events to one payment, booking, ticket and delivery", async () => {
    const context = setup();
    const draft = await createDraft(context.harness);
    await startPayment(context.harness, draft);
    const attempt = attemptRow(context.harness);
    const first = paidWebhookArgs(attempt);

    await webhook(context.harness, first);
    await expect(webhook(context.harness, first)).resolves.toMatchObject({ duplicate: true });
    await webhook(context.harness, paidWebhookArgs(attempt, { eventType: "checkout.session.async_payment_succeeded" }));
    await webhook(context.harness, paidWebhookArgs(attempt, { ticketCode: "tkt_77777777777777777777777777777777" }));
    await webhook(context.harness, {
      providerEventId: "evt_late_expired",
      eventType: "checkout.session.expired",
      outcome: "canceled",
      providerPaymentId: attempt.providerSessionId,
      orderRef: attempt.orderRef,
      attemptNonce: attempt.attemptNonce
    });

    expect(paidEvents(context.harness)).toHaveLength(1);
    expect(context.harness.rows("bookings")).toHaveLength(1);
    expect(context.harness.rows("ticketDeliveries")).toHaveLength(1);
    expect(context.harness.rows("ticketDeliveries")[0].ticketCode).toBe(first.ticketCode);
    expect(holdRow(context.harness).status).toBe("paid");
    expect(orderRow(context.harness).status).toBe("paid");
  });

  it("records a second distinct payment for one order as money with no second booking", async () => {
    const context = setup();
    const draft = await createDraft(context.harness);
    await startPayment(context.harness, draft);
    const attempt = attemptRow(context.harness);
    await webhook(context.harness, paidWebhookArgs(attempt));

    await webhook(context.harness, paidWebhookArgs(attempt, { providerPaymentIntentId: "pi_second_charge" }));

    expect(paidEvents(context.harness)).toHaveLength(1);
    expect(openExceptions(context.harness)[0]).toMatchObject({ code: "paid_payment_identity_conflict", moneyReceived: true });
    expect(context.harness.rows("bookings")).toHaveLength(1);
  });

  it("keeps durable paid evidence for an invalid stored snapshot, and staff refunds still reconcile without automation", async () => {
    const context = setup();
    const draft = await createDraft(context.harness);
    await startPayment(context.harness, draft);
    const attempt = attemptRow(context.harness);
    delete context.harness.rows("orderLineItems")[0].metadata;

    const result = await webhook(context.harness, paidWebhookArgs(attempt));

    expect(result.status).toBe("failed");
    expect(paidEvents(context.harness)).toHaveLength(1);
    expect(orderRow(context.harness).status).toBe("paid");
    expect(context.harness.rows("bookings")).toHaveLength(0);
    expect(openExceptions(context.harness)[0]).toMatchObject({ code: "paid_order_snapshot_invalid", moneyReceived: true });
    expect(context.stripe.calls.some((call) => call.path.startsWith("/refunds"))).toBe(false);

    // A staff-issued refund (outside this system) still correlates.
    await expect(
      context.harness.call(paymentInternals.recordStripeRefundWebhook, {
        providerEventId: "evt_staff_refund",
        eventType: "refund.updated",
        outcome: "refund",
        providerRefundId: "re_staff_1",
        providerPaymentIntentId: "pi_checkout_paid_1",
        refundStatus: "succeeded",
        amountCents: 4000,
        currency: "usd",
        providerEventCreatedAt: Date.now()
      })
    ).resolves.toMatchObject({ status: "processed" });
    expect(holdRow(context.harness).status).toBe("exception");
  });
});

describe("legacy and abandoned drafts", () => {
  it("adopts a pre-attempt Session for reconciliation and never sends it a new request", async () => {
    const { harness, stripe } = setup();
    const draft = await createDraft(harness);
    await harness.call(orderDrafts.beginCheckoutPaymentAttempt, draft);
    const legacySessionId = "cs_test_legacysession0001";
    // A long history of failures must never hide the one creation receipt.
    for (let index = 0; index < 150; index++) harness.seed("paymentEvents", {
      orderRef: draft.orderRef, provider: "stripe", providerPaymentId: legacySessionId,
      status: "failed", currency: "usd", amountCents: 4000, createdAt: Date.now() - 6 * minute
    });
    harness.seed("paymentEvents", {
      orderRef: draft.orderRef,
      provider: "stripe",
      providerPaymentId: legacySessionId,
      idempotencyKey: `skyla:checkout-session:${draft.orderRef}`,
      status: "created",
      currency: "usd",
      amountCents: 4000,
      raw: { url: `https://checkout.stripe.com/c/pay/${legacySessionId}` },
      createdAt: Date.now() - 5 * minute
    });
    stripe.sessions.set(legacySessionId, {
      id: legacySessionId,
      object: "checkout.session",
      livemode: false,
      mode: "payment",
      status: "open",
      payment_status: "unpaid",
      client_reference_id: draft.orderRef,
      metadata: { order_ref: draft.orderRef, source: "convex" },
      amount_total: 4000,
      currency: "usd"
    });

    await expect(startPayment(harness, draft)).resolves.toMatchObject({ checkoutSessionId: legacySessionId });
    expect(stripe.createCalls()).toHaveLength(0);
    expect(attemptRow(harness)).toMatchObject({ legacy: true, status: "open", providerSessionId: legacySessionId });

    vi.setSystemTime(Date.now() + 2 * minute);
    await runReconcileJobs(harness);
    expect(stripe.retrieveCalls()).toHaveLength(1);
    expect(holdRow(harness).status).toBe("payment_pending");
  });

  it("surfaces a legacy payment_pending order with no stored Session instead of creating one", async () => {
    const { harness, stripe } = setup();
    const draft = await createDraft(harness);
    await harness.call(orderDrafts.beginCheckoutPaymentAttempt, draft);

    await expect(startPayment(harness, draft)).rejects.toThrow("payment_needs_attention");

    expect(stripe.calls).toHaveLength(0);
    expect(openExceptions(harness)[0]).toMatchObject({ code: "legacy_payment_pending_without_session" });
    expect(holdRow(harness).status).toBe("payment_pending");
  });

  it("holds an overflowing legacy creation history for review without another Stripe request", async () => {
    const { harness, stripe } = setup();
    const draft = await createDraft(harness);
    await harness.call(orderDrafts.beginCheckoutPaymentAttempt, draft);
    for (let index = 0; index < 51; index++) harness.seed("paymentEvents", {
      orderRef: draft.orderRef, provider: "stripe", providerPaymentId: `cs_test_legacy_${index}`,
      status: "created", currency: "usd", amountCents: 4000, createdAt: Date.now()
    });

    await expect(startPayment(harness, draft)).rejects.toThrow("payment_needs_attention");
    expect(stripe.calls).toHaveLength(0);
    expect(harness.rows("checkoutPaymentAttempts")).toHaveLength(0);
    expect(holdRow(harness).status).toBe("payment_pending");
    expect(openExceptions(harness)[0]).toMatchObject({ code: "legacy_payment_pending_without_session" });
  });

  it("releases a replaced draft only while it is still a draft and the key matches", async () => {
    const { harness } = setup();
    const draft = await createDraft(harness);
    const release = (idempotencyKey: string) =>
      harness.call(orderDrafts.releaseCheckoutOrderDraft, {
        gatewayRateLimitKey: hexKey(),
        orderRef: draft.orderRef,
        idempotencyKey
      });

    await expect(release("checkout_wrong_key_0001")).resolves.toEqual({ released: false });
    expect(holdRow(harness).status).toBe("draft");
    await expect(release(draft.idempotencyKey)).resolves.toEqual({ released: true });
    expect(holdRow(harness)).toMatchObject({ status: "released", releaseReason: "draft_superseded" });
    expect(orderRow(harness)).toMatchObject({ status: "expired" });
    expect(orderRow(harness).customerEmailLower).toBeUndefined();

    const pending = await createDraft(harness);
    await startPayment(harness, pending);
    await expect(
      harness.call(orderDrafts.releaseCheckoutOrderDraft, {
        gatewayRateLimitKey: hexKey(),
        ...pending
      })
    ).resolves.toEqual({ released: false, status: "payment_pending" });
    expect(harness.rows("capacityReservations")[1].status).toBe("payment_pending");
  });
});

describe("browser-recoverable attempt status and staff exception reads", () => {
  it("reports each stage from stored state only, without personal data", async () => {
    const { harness, stripe } = setup();
    const draft = await createDraft(harness);
    const status = () => harness.call<Record<string, unknown>>(checkoutStatus.getCheckoutAttemptStatus, draft);

    await expect(status()).resolves.toEqual({ orderRef: draft.orderRef, status: "not_started" });
    stripe.fail("network_after_create");
    await expect(startPayment(harness, draft)).rejects.toThrow();
    await expect(status()).resolves.toEqual({ orderRef: draft.orderRef, status: "pending" });
    vi.setSystemTime(fridayNoon + minute);
    await startPayment(harness, draft);
    await expect(status()).resolves.toEqual({
      orderRef: draft.orderRef,
      status: "awaiting_payment",
      expiresAt: attemptRow(harness).expiresAt
    });
    await webhook(harness, paidWebhookArgs(attemptRow(harness)));
    const confirmed = await status();
    expect(confirmed).toMatchObject({ status: "confirmed", bookingRef: draft.orderRef, ticketCode: expect.stringMatching(/^tkt_/) });
    expect(JSON.stringify(confirmed)).not.toContain("guest@example.com");
    await expect(
      harness.call(checkoutStatus.getCheckoutAttemptStatus, { orderRef: draft.orderRef, idempotencyKey: "checkout_wrong_key_0002" })
    ).rejects.toThrow("Checkout payment was not found");
  });

  it("reports a paid order blocked by a billing exception as needing help", async () => {
    const { harness } = setup();
    const draft = await createDraft(harness);
    await startPayment(harness, draft);
    await webhook(harness, paidWebhookArgs(attemptRow(harness), { amountCents: 1 }));

    await expect(harness.call(checkoutStatus.getCheckoutAttemptStatus, draft)).resolves.toEqual({
      orderRef: draft.orderRef,
      status: "needs_attention"
    });
  });

  it("lists exceptions to admins and viewers only", async () => {
    const { harness } = setup();
    for (const [subject, role] of [["admin", "admin"], ["viewer", "viewer"], ["pos", "pos"]] as const) {
      harness.seed("staffUsers", { subject, emailLower: `${subject}@example.com`, role, active: true, createdAt: 1, updatedAt: 1 });
    }
    const draft = await createDraft(harness);
    await startPayment(harness, draft);
    await webhook(harness, paidWebhookArgs(attemptRow(harness), { sessionMode: "setup" }));

    await expect(harness.call(operationsExceptions.listOperationsExceptions, {}, "viewer")).resolves.toMatchObject({
      status: "open",
      capped: false,
      exceptions: [expect.objectContaining({ code: "paid_session_mode_invalid", moneyReceived: true, orderRef: draft.orderRef })]
    });
    await expect(harness.call(operationsExceptions.listOperationsExceptions, {}, "admin")).resolves.toMatchObject({
      exceptions: [expect.anything()]
    });
    await expect(harness.call(operationsExceptions.listOperationsExceptions, {}, "pos")).rejects.toThrow(
      "Staff role must be one of: admin, viewer"
    );
    await expect(harness.call(operationsExceptions.listOperationsExceptions, {})).rejects.toThrow(
      "Staff authentication is required"
    );
    await expect(harness.call(operationsExceptions.listOperationsExceptions, { limit: 500 }, "admin")).rejects.toThrow(
      "limit must be an integer from 1 to 50"
    );
  });
});
