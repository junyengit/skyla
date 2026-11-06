import { currentLiabilityWaiverVersion, currentTermsVersion } from "@skyla/payments";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as checkoutReconciliation from "./checkoutReconciliation";
import { createConvexHarness, createFakeStripe } from "./convexHarness.testkit";
import { classifyStripeCreateFailure } from "./lib/checkoutAttempts";
import * as orderDrafts from "./orderDrafts";
import * as paymentInternals from "./paymentInternals";
import * as payments from "./payments";

declare const process: { env: Record<string, string | undefined> };

// Friday 2026-10-02, 12:00 PM in Los Angeles.
const fridayNoon = Date.parse("2026-10-02T19:00:00.000Z");

async function setupDraft() {
  const harness = createConvexHarness({ orderDrafts, payments, paymentInternals, checkoutReconciliation });
  const draft = await harness.call<{ orderRef: string }>(orderDrafts.createCheckoutOrderDraft, {
    gatewayRateLimitKey: "a".repeat(64),
    packageKey: "general",
    adults: 2,
    visitDate: "2026-10-03",
    entryTime: "14:00",
    customerEmail: "guest@example.com",
    idempotencyKey: "checkout_attempt_0001"
  });
  const start = () =>
    harness.runAction(payments.createStripeCheckoutSession, {
      gatewayRateLimitKey: "b".repeat(64),
      orderRef: draft.orderRef,
      idempotencyKey: "checkout_attempt_0001",
      legalAcceptance: {
        termsAccepted: true,
        termsVersion: currentTermsVersion,
        liabilityWaiverAccepted: true,
        liabilityWaiverVersion: currentLiabilityWaiverVersion
      },
      successUrl: "https://skydeckla.com/checkout?stripe=success&session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: "https://skydeckla.com/checkout?stripe=cancel"
    });
  return { harness, orderRef: draft.orderRef, start };
}

function configureStripe() {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_capacity_fixture");
  process.env.SKYLA_STRIPE_MODE = "test";
  process.env.SKYLA_PAYMENT_RETURN_ORIGINS = "https://skydeckla.com";
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(fridayNoon);
});

afterEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.SKYLA_STRIPE_MODE;
  delete process.env.SKYLA_PAYMENT_RETURN_ORIGINS;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Stripe Checkout session attempt ordering", () => {
  it("stops before the payment_pending transition when provider credentials are missing", async () => {
    const { harness, start } = await setupDraft();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(start()).rejects.toThrow("STRIPE_SECRET_KEY is not configured");

    expect(harness.rows("orders")[0].status).toBe("draft");
    expect(harness.rows("capacityReservations")[0].status).toBe("draft");
    expect(harness.rows("checkoutPaymentAttempts")).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops before the payment_pending transition when the return origin is not allowed", async () => {
    configureStripe();
    process.env.SKYLA_PAYMENT_RETURN_ORIGINS = "https://other.example";
    const { harness, start } = await setupDraft();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(start()).rejects.toThrow("origin is not allowed");

    expect(harness.rows("orders")[0].status).toBe("draft");
    expect(harness.rows("checkoutPaymentAttempts")).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("moves the hold to payment_pending and stores the frozen attempt before calling Stripe, then records the session", async () => {
    configureStripe();
    const { harness, orderRef, start } = await setupDraft();
    const stripe = createFakeStripe();
    const seenAtNetworkTime: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      seenAtNetworkTime.push(
        `order:${harness.rows("orders")[0].status}`,
        `hold:${harness.rows("capacityReservations")[0].status}`,
        `attempt:${harness.rows("checkoutPaymentAttempts")[0]?.status}`,
        `key:${(init.headers as Record<string, string>)["Idempotency-Key"] === harness.rows("checkoutPaymentAttempts")[0]?.providerIdempotencyKey}`
      );
      return stripe.fetch(url, init);
    }));

    await expect(start()).resolves.toMatchObject({ checkoutSessionId: expect.stringMatching(/^cs_test_/) });

    expect(seenAtNetworkTime).toEqual(["order:payment_pending", "hold:payment_pending", "attempt:creating", "key:true"]);
    expect(harness.rows("checkoutPaymentAttempts")[0]).toMatchObject({ orderRef, status: "open" });
    expect(harness.rows("paymentEvents")).toEqual([
      expect.objectContaining({ orderRef, status: "created", providerPaymentId: expect.stringMatching(/^cs_test_/) })
    ]);
  });

  it("keeps the hold when the Stripe result is unknown", async () => {
    configureStripe();
    const { harness, start } = await setupDraft();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("network connection lost");
    }));

    await expect(start()).rejects.toThrow("did not confirm the payment page");

    expect(harness.rows("orders")[0].status).toBe("payment_pending");
    expect(harness.rows("capacityReservations")[0].status).toBe("payment_pending");
    expect(harness.rows("checkoutPaymentAttempts")[0]).toMatchObject({ status: "creation_unknown" });
    expect(harness.rows("capacityReservations")[0].releasedAt).toBeUndefined();
  });
});

describe("classifyStripeCreateFailure", () => {
  it.each([
    [400, { error: { type: "invalid_request_error" } }, "rejected"],
    [400, { error: { type: "invalid_request_error", code: "parameter_missing" } }, "rejected"],
    [400, { error: { type: "invalid_request_error", code: "parameter_unknown", param: "x" } }, "rejected"],
    [400, { error: { type: "invalid_request_error", code: "url_invalid" } }, "rejected"],
    [400, { error: { type: "invalid_request_error", code: null } }, "rejected"],
    [401, { error: { type: "authentication_error" } }, "rejected"],
    [401, { error: { type: "invalid_request_error" } }, "rejected"],
    [403, { error: { type: "permission_error" } }, "rejected"],
    [400, { error: { type: "idempotency_error" } }, "conflict"],
    [409, { error: { type: "idempotency_error" } }, "conflict"],
    [400, { error: { type: "validation_error" } }, "unknown"],
    [400, { error: { type: "x".repeat(5000) } }, "unknown"],
    [400, { error: { type: "invalid_request_error", code: "resource_missing" } }, "unknown"],
    [400, { error: { type: "invalid_request_error", code: "some_future_code" } }, "unknown"],
    [400, { error: { type: "invalid_request_error", code: "" } }, "unknown"],
    [400, { error: { type: "invalid_request_error", code: " " } }, "unknown"],
    [401, { error: { type: "authentication_error", code: "" } }, "unknown"],
    [400, { error: { type: "invalid_request_error", code: 42 } }, "unknown"],
    [400, { error: { type: "invalid_request_error", code: { nested: true } } }, "unknown"],
    [400, { error: { type: ["invalid_request_error"] } }, "unknown"],
    [400, { error: { type: "" } }, "unknown"],
    [400, { error: "invalid_request_error" }, "unknown"],
    [400, { type: "invalid_request_error" }, "unknown"],
    [400, null, "unknown"],
    [400, "Bad Request", "unknown"],
    [400, { error: { type: "api_error" } }, "unknown"],
    [402, { error: { type: "card_error", code: "card_declined" } }, "unknown"],
    [400, { error: { type: "card_error" } }, "unknown"],
    [401, { error: { type: "authentication_error", code: "secret_key_required" } }, "unknown"],
    [401, { error: { type: "api_error" } }, "unknown"],
    [403, { error: { type: "authentication_error" } }, "unknown"],
    [404, { error: { type: "invalid_request_error" } }, "unknown"],
    [404, { error: { type: "invalid_request_error", code: "resource_missing" } }, "unknown"],
    [409, { error: { type: "invalid_request_error" } }, "unknown"],
    [429, { error: { type: "rate_limit_error" } }, "unknown"],
    [429, { error: { type: "invalid_request_error" } }, "unknown"],
    [500, { error: { type: "api_error" } }, "unknown"],
    [502, { error: { type: "invalid_request_error" } }, "unknown"],
    [503, null, "unknown"],
    [Number.NaN, { error: { type: "invalid_request_error" } }, "unknown"]
  ])("HTTP %s %j is %s", (status, body, kind) => {
    expect(classifyStripeCreateFailure(status, body).kind).toBe(kind);
  });

  it("never reflects unrecognized or unbounded provider strings into the reason", () => {
    const huge = `<script>${"x".repeat(5000)}`;
    for (const body of [
      { error: { type: huge } },
      { error: { type: "invalid_request_error", code: huge } },
      { error: { type: "invalid_request_error", code: "Parameter Missing; DROP" } }
    ]) {
      const { reason } = classifyStripeCreateFailure(400, body);
      expect(reason).not.toContain("x".repeat(65));
      expect(reason).not.toContain("<");
      expect(reason).not.toContain(" ");
      expect(reason.length).toBeLessThanOrEqual(120);
    }
    expect(classifyStripeCreateFailure(Number.NaN, null).reason).toBe("stripe_http_0_malformed");
  });
});

type CreateCall = { idempotencyKey?: string; body?: string };

/** Fake Stripe whose next Checkout creates follow a script before falling back to the fake. */
function scriptedStripe(script: Array<() => Response>) {
  const stripe = createFakeStripe();
  const creates: CreateCall[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    if (init.method === "POST" && new URL(url).pathname === "/v1/checkout/sessions") {
      creates.push({ idempotencyKey: (init.headers as Record<string, string>)["Idempotency-Key"], body: String(init.body) });
      const next = script.shift();
      if (next) return next();
    }
    return stripe.fetch(url, init);
  }));
  return { stripe, creates };
}

const stripeError = (status: number, body: unknown) => () =>
  typeof body === "string" ? new Response(body, { status }) : Response.json(body, { status });

function expectHeldUnreleased(harness: Awaited<ReturnType<typeof setupDraft>>["harness"]) {
  expect(harness.rows("orders")[0].status).toBe("payment_pending");
  expect(harness.rows("capacityReservations")[0].status).toBe("payment_pending");
  expect(harness.rows("capacityReservations")[0].releasedAt).toBeUndefined();
}

const reconcileJob = "checkoutReconciliation:reconcileCheckoutAttempt";

describe("Stripe Checkout create failures that do not prove no Session", () => {
  it.each([
    ["an arbitrary 400 type", stripeError(400, { error: { type: "validation_error", message: "nope" } })],
    ["an unbounded 400 type", stripeError(400, { error: { type: "y".repeat(5000) } })],
    ["invalid_request_error with an unrecognized code", stripeError(400, { error: { type: "invalid_request_error", code: "some_future_code" } })],
    ["invalid_request_error with resource_missing", stripeError(400, { error: { type: "invalid_request_error", code: "resource_missing" } })],
    ["a non-string code", stripeError(400, { error: { type: "invalid_request_error", code: 400 } })],
    ["a non-string type", stripeError(400, { error: { type: { name: "invalid_request_error" } } })],
    ["a string error field", stripeError(400, { error: "invalid_request_error" })],
    ["a non-JSON 400 body", stripeError(400, "<html>Bad Request</html>")],
    ["a card error", stripeError(402, { error: { type: "card_error", code: "card_declined" } })],
    ["a 404", stripeError(404, { error: { type: "invalid_request_error" } })],
    ["a 409", stripeError(409, { error: { type: "invalid_request_error" } })],
    ["a 429", stripeError(429, { error: { type: "rate_limit_error" } })],
    ["a 500 api_error", stripeError(500, { error: { type: "api_error" } })]
  ])("keeps the hold and the creation_unknown attempt for %s on the first request", async (_label, response) => {
    configureStripe();
    const { harness, start } = await setupDraft();
    const { stripe, creates } = scriptedStripe([response]);

    await expect(start()).rejects.toThrow("did not confirm the payment page");

    expectHeldUnreleased(harness);
    const attempt = harness.rows("checkoutPaymentAttempts")[0];
    expect(attempt).toMatchObject({ status: "creation_unknown", providerRequestCount: 1 });
    expect(String(attempt.lastError).length).toBeLessThanOrEqual(120);
    expect(String(attempt.lastError)).not.toContain("yyyy");
    expect(attempt.reconcileAt).toEqual(expect.any(Number));
    expect(creates).toHaveLength(1);
    expect(stripe.sessions.size).toBe(0);
  });

  it.each([
    ["a validation error without a code", stripeError(400, { error: { type: "invalid_request_error", message: "Invalid URL" } })],
    ["parameter_missing", stripeError(400, { error: { type: "invalid_request_error", code: "parameter_missing", param: "line_items" } })],
    ["parameter_invalid_integer", stripeError(400, { error: { type: "invalid_request_error", code: "parameter_invalid_integer" } })],
    ["an authentication error", stripeError(401, { error: { type: "authentication_error" } })],
    ["a permission error", stripeError(403, { error: { type: "permission_error" } })]
  ])("releases the unpaid hold once Stripe refused the only request with %s", async (_label, response) => {
    configureStripe();
    const { harness, start } = await setupDraft();
    const { stripe, creates } = scriptedStripe([response]);

    await expect(start()).rejects.toThrow("rejected the payment request");

    expect(harness.rows("checkoutPaymentAttempts")[0]).toMatchObject({ status: "rejected", providerRequestCount: 1 });
    expect(harness.rows("orders")[0].status).toBe("canceled");
    expect(harness.rows("capacityReservations")[0]).toMatchObject({ status: "released", releaseReason: "stripe_creation_rejected" });
    await expect(start()).rejects.toThrow("payment_session_closed");
    expect(creates).toHaveLength(1);
    expect(stripe.sessions.size).toBe(0);
  });

  it("treats an idempotency error as a conflict that keeps the hold", async () => {
    configureStripe();
    const { harness, start } = await setupDraft();
    const { creates } = scriptedStripe([stripeError(400, { error: { type: "idempotency_error" } })]);

    await expect(start()).rejects.toThrow("payment_needs_attention");

    expectHeldUnreleased(harness);
    expect(harness.rows("checkoutPaymentAttempts")[0]).toMatchObject({ status: "exception" });
    await expect(start()).rejects.toThrow("payment_needs_attention");
    expect(creates).toHaveLength(1);
  });

  it("never releases the hold when a guest retry gets a deterministic 4xx after an unknown first create", async () => {
    configureStripe();
    const { harness, start } = await setupDraft();
    const { stripe, creates } = scriptedStripe([
      () => {
        throw new TypeError("network connection lost");
      },
      stripeError(400, { error: { type: "invalid_request_error", code: "parameter_missing" } })
    ]);

    await expect(start()).rejects.toThrow("did not confirm the payment page");
    expectHeldUnreleased(harness);
    const frozen = harness.rows("checkoutPaymentAttempts")[0];

    await expect(start()).rejects.toThrow("payment_needs_attention");

    expectHeldUnreleased(harness);
    expect(harness.rows("checkoutPaymentAttempts")[0]).toMatchObject({ status: "exception", providerRequestCount: 2 });
    expect(creates).toHaveLength(2);
    expect(creates[1]).toEqual(creates[0]);
    expect(creates[1].idempotencyKey).toBe(frozen.providerIdempotencyKey);

    // Further retries and the sweep never send a new request or open a Session.
    await expect(start()).rejects.toThrow("payment_needs_attention");
    vi.setSystemTime(fridayNoon + 30 * 60 * 1000);
    await harness.call(checkoutReconciliation.sweepCheckoutAttempts, {});
    await harness.runDueJobs((job) => job.name === reconcileJob);
    expect(creates).toHaveLength(2);
    expect(stripe.sessions.size).toBe(0);
    expectHeldUnreleased(harness);
  });

  it("never releases the hold when a scheduled replay gets an auth refusal after an unknown first create", async () => {
    configureStripe();
    const { harness, start } = await setupDraft();
    const { stripe, creates } = scriptedStripe([
      stripeError(500, { error: { type: "api_error" } }),
      stripeError(401, { error: { type: "authentication_error" } })
    ]);

    await expect(start()).rejects.toThrow("did not confirm the payment page");
    const reconcileAt = harness.rows("checkoutPaymentAttempts")[0].reconcileAt as number;
    vi.setSystemTime(reconcileAt);
    await harness.runDueJobs((job) => job.name === reconcileJob);

    expectHeldUnreleased(harness);
    expect(harness.rows("checkoutPaymentAttempts")[0]).toMatchObject({ status: "exception", providerRequestCount: 2 });
    expect(creates).toHaveLength(2);
    expect(creates[1]).toEqual(creates[0]);
    await expect(start()).rejects.toThrow("payment_needs_attention");
    expect(creates).toHaveLength(2);
    expect(stripe.sessions.size).toBe(0);
  });
});
