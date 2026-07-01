import { describe, expect, it } from "vitest";

import {
  assertStripeTerminalReaderProcessResult,
  buildStripeTerminalPaymentIntentRequest,
  buildStripeTerminalReaderProcessRequest,
  stripeTerminalIntentIdempotencyKey,
  stripeTerminalReaderPaymentStatus,
  stripeTerminalProcessIdempotencyKey
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

  it("builds a server-driven reader process request for a stored reader and intent", () => {
    const request = buildStripeTerminalReaderProcessRequest({
      saleRef: "POS2607-ABC123",
      paymentIntentId: "pi_test_123",
      readerId: "tmr_test_123",
      processAttempt: 1,
      amountCents: 8550,
      currency: "usd"
    });

    expect(request.endpoint).toBe("/terminal/readers/tmr_test_123/process_payment_intent");
    expect(request.idempotencyKey).toBe(
      "skyla:terminal-process:POS2607-ABC123:pi_test_123:tmr_test_123:attempt-1"
    );
    expect(request.body.get("payment_intent")).toBe("pi_test_123");
    expect(request.body.get("process_config[enable_customer_cancellation]")).toBe("true");
  });

  it("rejects malformed reader process snapshots before Stripe", () => {
    expect(() =>
      buildStripeTerminalReaderProcessRequest({
        saleRef: "POS2607-ABC123",
        paymentIntentId: "pi_test_123",
        readerId: "reader_from_browser",
        processAttempt: 1,
        amountCents: 8550,
        currency: "usd"
      })
    ).toThrow("Stripe Terminal reader id must look like tmr_");

    expect(() =>
      buildStripeTerminalReaderProcessRequest({
        saleRef: "POS2607-ABC123",
        paymentIntentId: "",
        readerId: "tmr_test_123",
        processAttempt: 1,
        amountCents: 8550,
        currency: "usd"
      })
    ).toThrow("Stripe Terminal PaymentIntent id is required");
  });

  it("keeps reader-process idempotency separate from intent creation", () => {
    expect(stripeTerminalProcessIdempotencyKey("POS2607-ABC123", "pi_test_123", "tmr_test_123", 2)).toBe(
      "skyla:terminal-process:POS2607-ABC123:pi_test_123:tmr_test_123:attempt-2"
    );
    expect(() => stripeTerminalProcessIdempotencyKey("POS2607-ABC123", "", "tmr_test_123", 1)).toThrow(
      "paymentIntentId is required"
    );
    expect(() => stripeTerminalProcessIdempotencyKey("POS2607-ABC123", "pi_test_123", "tmr_test_123", 0)).toThrow(
      "processAttempt must be a positive integer"
    );
  });

  it("does not treat reader handoff as paid without later reconciliation", () => {
    expect(stripeTerminalReaderPaymentStatus({ action: { status: "succeeded" } })).toBe("processing");
    expect(stripeTerminalReaderPaymentStatus({ action: { status: "in_progress" } })).toBe("processing");
    expect(stripeTerminalReaderPaymentStatus({ action: { status: "failed" } })).toBe("failed");
  });

  it("requires Stripe to echo the intended process_payment_intent action", () => {
    expect(() =>
      assertStripeTerminalReaderProcessResult(
        { action: { status: "in_progress" } },
        "pi_test_123"
      )
    ).toThrow("Stripe reader did not start a PaymentIntent process action");

    expect(() =>
      assertStripeTerminalReaderProcessResult(
        { action: { type: "process_payment_intent", status: "in_progress" } },
        "pi_test_123"
      )
    ).toThrow("Stripe reader did not echo the PaymentIntent");

    expect(() =>
      assertStripeTerminalReaderProcessResult(
        {
          action: {
            type: "process_payment_intent",
            status: "in_progress",
            process_payment_intent: { payment_intent: "pi_other" }
          }
        },
        "pi_test_123"
      )
    ).toThrow("Stripe reader returned a different PaymentIntent");

    expect(() =>
      assertStripeTerminalReaderProcessResult(
        {
          action: {
            type: "process_payment_intent",
            status: "in_progress",
            process_payment_intent: { payment_intent: "pi_test_123" }
          }
        },
        "pi_test_123"
      )
    ).not.toThrow();
  });
});
