import { currentLiabilityWaiverVersion, currentTermsVersion } from "@skyla/payments";
import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createStripeCheckoutSession } from "./payments";

declare const process: { env: Record<string, string | undefined> };

const orderRef = "ORD261002-HOLD01";
const snapshot = {
  orderRef,
  currency: "usd",
  subtotalCents: 4000,
  feeCents: 0,
  totalCents: 4000,
  customerEmailLower: "guest@example.com",
  visitDate: "2026-10-03",
  entryTime: "14:00",
  termsVersion: currentTermsVersion,
  liabilityWaiverVersion: currentLiabilityWaiverVersion,
  lines: [{ name: "The View · Adult 18+", quantity: 2, unitAmountCents: 2000, lineTotalCents: 4000 }]
};
const args = {
  gatewayRateLimitKey: "b".repeat(64),
  orderRef,
  idempotencyKey: "checkout_attempt_0001",
  legalAcceptance: {
    termsAccepted: true,
    termsVersion: currentTermsVersion,
    liabilityWaiverAccepted: true,
    liabilityWaiverVersion: currentLiabilityWaiverVersion
  },
  successUrl: "https://skydeckla.com/checkout?stripe=success&session_id={CHECKOUT_SESSION_ID}",
  cancelUrl: "https://skydeckla.com/checkout?stripe=cancel"
};

// Records every Convex step and the Stripe network call in one ordered log.
function createActionCtx(log: string[]) {
  const record = async (reference: FunctionReference<"query" | "mutation">) => {
    const name = getFunctionName(reference);
    log.push(name);
    return name === "paymentInternals:getCheckoutPaymentSnapshot" ? snapshot : { ok: true };
  };
  return { runQuery: vi.fn(record), runMutation: vi.fn(record) };
}

function runSessionAction(ctx: ReturnType<typeof createActionCtx>) {
  return (createStripeCheckoutSession as unknown as {
    _handler: (context: typeof ctx, input: typeof args) => Promise<unknown>;
  })._handler(ctx, args);
}

function configureStripe() {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_capacity_fixture");
  process.env.SKYLA_STRIPE_MODE = "test";
  process.env.SKYLA_PAYMENT_RETURN_ORIGINS = "https://skydeckla.com";
}

afterEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.SKYLA_STRIPE_MODE;
  delete process.env.SKYLA_PAYMENT_RETURN_ORIGINS;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Stripe Checkout session attempt ordering", () => {
  it("stops before the payment_pending transition when provider credentials are missing", async () => {
    const log: string[] = [];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(runSessionAction(createActionCtx(log))).rejects.toThrow("STRIPE_SECRET_KEY is not configured");

    expect(log).not.toContain("orderDrafts:beginCheckoutPaymentAttempt");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops before the payment_pending transition when the return origin is not allowed", async () => {
    configureStripe();
    process.env.SKYLA_PAYMENT_RETURN_ORIGINS = "https://other.example";
    const log: string[] = [];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(runSessionAction(createActionCtx(log))).rejects.toThrow("origin is not allowed");

    expect(log).not.toContain("orderDrafts:beginCheckoutPaymentAttempt");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("moves the hold to payment_pending before calling Stripe, then records the session", async () => {
    configureStripe();
    const log: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        log.push(`stripe:${(init.headers as Record<string, string>)["Idempotency-Key"]}`);
        return Response.json({ id: "cs_test_hold", url: "https://checkout.stripe.com/c/pay/cs_test_hold", amount_total: 4000, currency: "usd" });
      })
    );

    await expect(runSessionAction(createActionCtx(log))).resolves.toMatchObject({ checkoutSessionId: "cs_test_hold" });

    expect(log).toEqual([
      "payments:consumeStripeCheckoutRateLimit",
      "orderDrafts:assertCheckoutOrderDraftActive",
      "paymentInternals:recordCheckoutLegalAcceptance",
      "paymentInternals:getCheckoutPaymentSnapshot",
      "orderDrafts:beginCheckoutPaymentAttempt",
      `stripe:skyla:checkout-session:${orderRef}`,
      "paymentInternals:recordStripeCheckoutSession"
    ]);
  });

  it("keeps the hold when the Stripe result is unknown", async () => {
    configureStripe();
    const log: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("network connection lost");
    }));

    await expect(runSessionAction(createActionCtx(log))).rejects.toThrow("network connection lost");

    expect(log.at(-1)).toBe("orderDrafts:beginCheckoutPaymentAttempt");
    expect(log.some((step) => /expire|release|cancel/i.test(step))).toBe(false);
  });
});
