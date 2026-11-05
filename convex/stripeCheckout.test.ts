import { describe, expect, it } from "vitest";
import { currentLiabilityWaiverVersion, currentTermsVersion } from "@skyla/payments";

import {
  assertStripeReturnOriginAllowed,
  buildStripeCheckoutSessionRequest,
  parseStripeReturnOriginAllowlist,
  stripeApiVersion,
  stripeCheckoutIdempotencyKey,
  stripeCheckoutLineItems
} from "./lib/stripeCheckout";

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
      name: "The View",
      quantity: 2,
      unitAmountCents: 2000,
      lineTotalCents: 4000
    },
    {
      name: "The View Child",
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
