import { describe, expect, it } from "vitest";

import {
  assertStripeReturnOriginAllowed,
  buildStripeCheckoutSessionRequest,
  parseStripeReturnOriginAllowlist,
  stripeCheckoutIdempotencyKey,
  stripeCheckoutLineItems
} from "./lib/stripeCheckout";

const snapshot = {
  orderRef: "SKY2607-ABC123",
  currency: "usd" as const,
  subtotalCents: 8100,
  feeCents: 405,
  totalCents: 8505,
  customerEmailLower: "guest@example.com",
  visitDate: "2026-07-04",
  entryTime: "19:00",
  lines: [
    {
      name: "General Admission",
      quantity: 2,
      unitAmountCents: 2900,
      lineTotalCents: 5800
    },
    {
      name: "General Admission Child",
      quantity: 1,
      unitAmountCents: 1450,
      lineTotalCents: 1450
    },
    {
      name: "Matcha Set",
      quantity: 1,
      unitAmountCents: 850,
      lineTotalCents: 850
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
    expect(request.idempotencyKey).toBe("skyla:checkout-session:SKY2607-ABC123");
    expect(request.body.get("mode")).toBe("payment");
    expect(request.body.get("client_reference_id")).toBe("SKY2607-ABC123");
    expect(request.body.get("customer_email")).toBe("guest@example.com");
    expect(request.body.get("metadata[order_ref]")).toBe("SKY2607-ABC123");
    expect(request.body.get("metadata[source]")).toBe("convex");
    expect(request.body.get("metadata[visit_date]")).toBe("2026-07-04");
    expect(request.body.get("metadata[entry_time]")).toBe("19:00");
    expect(request.body.get("line_items[0][price_data][unit_amount]")).toBe("2900");
    expect(request.body.get("line_items[0][quantity]")).toBe("2");
    expect(request.body.get("line_items[3][price_data][product_data][name]")).toBe("Online booking fee");
    expect(request.body.get("line_items[3][price_data][unit_amount]")).toBe("405");
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
