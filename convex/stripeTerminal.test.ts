import { describe, expect, it } from "vitest";

import {
  buildStripeTerminalPaymentIntentRequest,
  stripeTerminalIntentIdempotencyKey
} from "./lib/stripeTerminal";

const snapshot = {
  saleRef: "POS2607-ABC123",
  currency: "usd" as const,
  subtotalCents: 8550,
  feeCents: 0,
  totalCents: 8550,
  customerEmailLower: "guest@example.com",
  readerId: "tmr_123",
  terminalLocationId: "tml_123",
  lines: [
    {
      name: "General Admission",
      quantity: 2,
      unitAmountCents: 2900,
      lineTotalCents: 5800
    },
    {
      name: "Matcha Set",
      quantity: 1,
      unitAmountCents: 850,
      lineTotalCents: 850
    },
    {
      name: "Custom service",
      quantity: 1,
      unitAmountCents: 1900,
      lineTotalCents: 1900
    }
  ]
};

describe("Stripe Terminal helpers", () => {
  it("builds a card-present PaymentIntent request only from a stored POS sale", () => {
    const request = buildStripeTerminalPaymentIntentRequest(snapshot);

    expect(request.endpoint).toBe("/payment_intents");
    expect(request.idempotencyKey).toBe("skyla:terminal-intent:POS2607-ABC123");
    expect(request.body.get("amount")).toBe("8550");
    expect(request.body.get("currency")).toBe("usd");
    expect(request.body.get("payment_method_types[]")).toBe("card_present");
    expect(request.body.get("capture_method")).toBe("automatic");
    expect(request.body.get("receipt_email")).toBe("guest@example.com");
    expect(request.body.get("metadata[sale_ref]")).toBe("POS2607-ABC123");
    expect(request.body.get("metadata[source]")).toBe("convex-terminal");
    expect(request.body.get("metadata[line_count]")).toBe("3");
    expect(request.body.get("metadata[reader_id]")).toBe("tmr_123");
    expect(request.body.get("metadata[terminal_location_id]")).toBe("tml_123");
  });

  it("fails before Stripe if stored POS sale lines do not reconcile to the stored total", () => {
    expect(() =>
      buildStripeTerminalPaymentIntentRequest({
        ...snapshot,
        totalCents: 9999
      })
    ).toThrow("Stored POS sale subtotal does not match sale total");

    expect(() =>
      buildStripeTerminalPaymentIntentRequest({
        ...snapshot,
        subtotalCents: 9999
      })
    ).toThrow("Stored POS sale lines do not match sale subtotal");
  });

  it("rejects booking-fee shaped POS sales", () => {
    expect(() =>
      buildStripeTerminalPaymentIntentRequest({
        ...snapshot,
        feeCents: 405,
        totalCents: 8955
      })
    ).toThrow("Stripe Terminal POS sales do not support booking fees");
  });

  it("keeps idempotency stable per sale reference", () => {
    expect(stripeTerminalIntentIdempotencyKey("POS2607-ABC123")).toBe(
      "skyla:terminal-intent:POS2607-ABC123"
    );
    expect(() => stripeTerminalIntentIdempotencyKey("   ")).toThrow("saleRef is required");
  });
});
