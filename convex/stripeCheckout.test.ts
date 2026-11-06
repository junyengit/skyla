import { describe, expect, it } from "vitest";
import { currentLiabilityWaiverVersion, currentTermsVersion } from "@skyla/payments";

import {
  assertStripeReturnOriginAllowed,
  buildStripeCheckoutSessionRequest,
  parseStripeReturnOriginAllowlist,
  stripeApiVersion,
  stripeCheckoutAttemptIdempotencyKey,
  stripeCheckoutIdempotencyKey,
  stripeCheckoutLineItems
} from "./lib/stripeCheckout";
import { checkoutPaymentStateError, parseCheckoutPaymentStateError } from "./lib/checkoutAttempts";

const snapshot = {
  orderRef: "SKY2607-ABC123",
  currency: "usd" as const,
  subtotalCents: 5800,
  feeCents: 0,
  totalCents: 5800,
  customerEmailLower: "guest@example.com",
  visitDate: "2026-07-04",
  entryTime: "19:00",
  termsVersion: currentTermsVersion,
  liabilityWaiverVersion: currentLiabilityWaiverVersion,
  lines: [
    {
      name: "The View · Adult 18+",
      quantity: 2,
      unitAmountCents: 2000,
      lineTotalCents: 4000
    },
    {
      name: "The View · Youth 8–17",
      quantity: 1,
      unitAmountCents: 1000,
      lineTotalCents: 1000
    },
    {
      name: "Ceremonial Matcha Latte",
      quantity: 1,
      unitAmountCents: 800,
      lineTotalCents: 800
    }
  ]
};

describe("Stripe Checkout helpers", () => {
  it("builds a Stripe Checkout Session request only from stored Convex totals and lines", () => {
    const request = buildStripeCheckoutSessionRequest(snapshot, {
      successUrl: "https://skydeckla.com/checkout?stripe=success&session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: "https://skydeckla.com/checkout?stripe=cancel"
    });

    expect(request.endpoint).toBe("/checkout/sessions");
    expect(request.apiVersion).toBe(stripeApiVersion);
    expect(stripeApiVersion).toBe("2026-02-25.clover");
    expect(request.idempotencyKey).toBe("skyla:checkout-session:SKY2607-ABC123");
    expect(request.body.get("mode")).toBe("payment");
    expect(request.body.get("client_reference_id")).toBe("SKY2607-ABC123");
    expect(request.body.get("customer_email")).toBe("guest@example.com");
    expect(request.body.get("metadata[order_ref]")).toBe("SKY2607-ABC123");
    expect(request.body.get("metadata[source]")).toBe("convex");
    expect(request.body.get("metadata[terms_version]")).toBe(currentTermsVersion);
    expect(request.body.get("metadata[liability_waiver_version]")).toBe(currentLiabilityWaiverVersion);
    expect(request.body.get("metadata[visit_date]")).toBe("2026-07-04");
    expect(request.body.get("metadata[entry_time]")).toBe("19:00");
    expect(request.body.get("line_items[0][price_data][unit_amount]")).toBe("2000");
    expect(request.body.get("line_items[0][quantity]")).toBe("2");
    expect(request.body.get("line_items[3][price_data][product_data][name]")).toBeNull();
    expect(request.body.get("line_items[3][price_data][unit_amount]")).toBeNull();
  });

  it("keeps free child lines off the Stripe session while totals still reconcile", () => {
    const freeChildSnapshot = {
      ...snapshot,
      subtotalCents: 4000,
      totalCents: 4000,
      lines: [
        { name: "The View · Adult 18+", quantity: 1, unitAmountCents: 2000, lineTotalCents: 2000 },
        { name: "The View · Youth 8–17", quantity: 2, unitAmountCents: 1000, lineTotalCents: 2000 },
        { name: "The View · Child 0–7", quantity: 3, unitAmountCents: 0, lineTotalCents: 0 }
      ]
    };

    expect(stripeCheckoutLineItems(freeChildSnapshot)).toEqual([
      { name: "The View · Adult 18+", quantity: 1, unitAmountCents: 2000 },
      { name: "The View · Youth 8–17", quantity: 2, unitAmountCents: 1000 }
    ]);
    const request = buildStripeCheckoutSessionRequest(freeChildSnapshot, {
      successUrl: "https://skydeckla.com/checkout?stripe=success&session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: "https://skydeckla.com/checkout?stripe=cancel"
    });
    expect(request.body.get("line_items[1][price_data][unit_amount]")).toBe("1000");
    expect(request.body.get("line_items[2][quantity]")).toBeNull();
    expect([...request.body.values()].join(" ")).not.toContain("Child 0–7");
  });

  it("still rejects stored line prices between free and the Stripe minimum", () => {
    expect(() =>
      stripeCheckoutLineItems({
        ...snapshot,
        subtotalCents: 5803,
        totalCents: 5803,
        lines: [...snapshot.lines, { name: "Odd line", quantity: 3, unitAmountCents: 1, lineTotalCents: 3 }]
      })
    ).toThrow("Stripe checkout line unit amount must be free or at least 50 cents");
    expect(() =>
      stripeCheckoutLineItems({
        ...snapshot,
        lines: [...snapshot.lines, { name: "Bad free line", quantity: 0, unitAmountCents: 0, lineTotalCents: 0 }]
      })
    ).toThrow("Stripe checkout line quantity must be a positive integer");
  });

  it("fails before Stripe if stored lines do not reconcile to the stored order total", () => {
    expect(() =>
      stripeCheckoutLineItems({
        ...snapshot,
        totalCents: 9999
      })
    ).toThrow("Stripe checkout lines do not match order total");

    expect(() =>
      stripeCheckoutLineItems({
        ...snapshot,
        subtotalCents: 9999
      })
    ).toThrow("Stored line items do not match order subtotal");
  });

  it("freezes a per-attempt key, nonce, card-only method and explicit expiry into the request", () => {
    const expiresAt = Date.parse("2026-07-04T19:45:00.000Z");
    const request = buildStripeCheckoutSessionRequest(
      snapshot,
      {
        successUrl: "https://skydeckla.com/checkout?stripe=success&session_id={CHECKOUT_SESSION_ID}",
        cancelUrl: "https://skydeckla.com/checkout?stripe=cancel"
      },
      { attemptNonce: "0123456789abcdef0123456789abcdef", expiresAt }
    );

    expect(request.idempotencyKey).toBe("skyla:checkout-session:v2:SKY2607-ABC123:0123456789abcdef0123456789abcdef");
    expect(request.body.get("expires_at")).toBe(String(expiresAt / 1000));
    expect(request.body.get("metadata[attempt_nonce]")).toBe("0123456789abcdef0123456789abcdef");
    expect(request.body.get("payment_method_types[0]")).toBe("card");
    expect(request.body.getAll("payment_method_types[1]")).toEqual([]);
    expect(() => stripeCheckoutAttemptIdempotencyKey("SKY2607-ABC123", "Not-A-Nonce")).toThrow("attemptNonce is invalid");
  });

  it("maps customer-safe payment states to stable codes", () => {
    expect(parseCheckoutPaymentStateError(checkoutPaymentStateError("payment_in_progress").message)).toEqual({
      code: "payment_in_progress",
      message: "Your card payment page is still being prepared. Check again in a moment."
    });
    expect(parseCheckoutPaymentStateError("Uncaught Error: Checkout payment state: payment_needs_attention: x")).toMatchObject({
      code: "payment_needs_attention"
    });
    expect(parseCheckoutPaymentStateError("Checkout payment state: made_up: x")).toBeNull();
  });

  it("keeps idempotency stable per order reference", () => {
    expect(stripeCheckoutIdempotencyKey("SKY2607-ABC123")).toBe("skyla:checkout-session:SKY2607-ABC123");
    expect(() => stripeCheckoutIdempotencyKey("   ")).toThrow("orderRef is required");
  });

  it("allows only configured Stripe return origins", () => {
    const allowlist = parseStripeReturnOriginAllowlist(
      "https://skydeckla.com, https://www.skydeckla.com, http://localhost:3000"
    );

    expect(
      assertStripeReturnOriginAllowed(
        "https://skydeckla.com/checkout?stripe=success&session_id={CHECKOUT_SESSION_ID}",
        "successUrl",
        allowlist
      )
    ).toContain("{CHECKOUT_SESSION_ID}");
    expect(
      assertStripeReturnOriginAllowed("http://localhost:3000/checkout?stripe=cancel", "cancelUrl", allowlist)
    ).toBe("http://localhost:3000/checkout?stripe=cancel");
    expect(() =>
      assertStripeReturnOriginAllowed("https://example.com/checkout?stripe=success", "successUrl", allowlist)
    ).toThrow("successUrl origin is not allowed for Stripe checkout");
  });

  it("rejects malformed return origin allowlists", () => {
    expect(() => parseStripeReturnOriginAllowlist(undefined)).toThrow(
      "SKYLA_PAYMENT_RETURN_ORIGINS must list at least one allowed Stripe return origin"
    );
    expect(() => parseStripeReturnOriginAllowlist("https://skydeckla.com/checkout")).toThrow(
      "SKYLA_PAYMENT_RETURN_ORIGINS entries must be origins, not full paths"
    );
    expect(() => parseStripeReturnOriginAllowlist("http://skydeckla.com")).toThrow(
      "SKYLA_PAYMENT_RETURN_ORIGINS must use https outside localhost"
    );
  });
});
