import { currentLiabilityWaiverVersion, currentTermsVersion } from "@skyla/payments";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as checkoutReconciliation from "./checkoutReconciliation";
import { createConvexHarness, createFakeStripe } from "./convexHarness.testkit";
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
