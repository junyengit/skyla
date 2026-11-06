import { describe, expect, it } from "vitest";

import {
  assertStripeTerminalReaderProcessResult,
  buildStripeTerminalPaymentIntentRequest,
  buildStripeTerminalReaderProcessRequest,
  classifyRetrievedTerminalIntent,
  stripeApiVersion,
  stripeTerminalAttemptIdempotencyKey,
  stripeTerminalIntentIdempotencyKey,
  stripeTerminalReaderPaymentStatus,
  stripeTerminalProcessIdempotencyKey,
  verifyCreatedTerminalIntent
} from "./lib/stripeTerminal";

const nonce = "0123456789abcdef0123456789abcdef";

const snapshot = {
  saleRef: "POS2607-ABC123",
  currency: "usd" as const,
  subtotalCents: 6750,
  feeCents: 0,
  totalCents: 6750,
  customerEmailLower: "guest@example.com",
  readerId: "tmr_123",
  terminalLocationId: "tml_123",
  lines: [
    {
      name: "The View",
      quantity: 2,
      unitAmountCents: 2000,
      lineTotalCents: 4000
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
    const request = buildStripeTerminalPaymentIntentRequest(snapshot, { attemptNonce: nonce });

    expect(request.endpoint).toBe("/payment_intents");
    expect(request.apiVersion).toBe(stripeApiVersion);
    expect(stripeApiVersion).toBe("2026-02-25.clover");
    expect(request.idempotencyKey).toBe(`skyla:terminal-intent:v2:POS2607-ABC123:${nonce}`);
    expect(request.body.get("amount")).toBe("6750");
    expect(request.body.get("currency")).toBe("usd");
    expect(request.body.get("payment_method_types[]")).toBe("card_present");
    expect(request.body.get("capture_method")).toBe("automatic");
    expect(request.body.get("receipt_email")).toBe("guest@example.com");
    expect(request.body.get("metadata[sale_ref]")).toBe("POS2607-ABC123");
    expect(request.body.get("metadata[source]")).toBe("convex-terminal");
    expect(request.body.get("metadata[attempt_nonce]")).toBe(nonce);
    expect(request.body.get("metadata[line_count]")).toBe("3");
    expect(request.body.get("metadata[reader_id]")).toBe("tmr_123");
    expect(request.body.get("metadata[terminal_location_id]")).toBe("tml_123");
    expect(request.body.has("metadata[visit_date]")).toBe(false);
  });

  it("accepts zero-priced canonical child lines under a positive total and records the visit", () => {
    const request = buildStripeTerminalPaymentIntentRequest(
      {
        ...snapshot,
        subtotalCents: 3000,
        totalCents: 3000,
        visitDate: "2026-10-03",
        entryTime: "14:00",
        partySize: 5,
        lines: [
          { name: "The View · Adult 18+", quantity: 1, unitAmountCents: 2000, lineTotalCents: 2000 },
          { name: "The View · Youth 8–17", quantity: 1, unitAmountCents: 1000, lineTotalCents: 1000 },
          { name: "The View · Child 0–7", quantity: 3, unitAmountCents: 0, lineTotalCents: 0 }
        ]
      },
      { attemptNonce: nonce }
    );
    expect(request.body.get("amount")).toBe("3000");
    expect(request.body.get("metadata[visit_date]")).toBe("2026-10-03");
    expect(request.body.get("metadata[entry_time]")).toBe("14:00");
    expect(request.body.get("metadata[party_size]")).toBe("5");
  });

  it("fails before Stripe if stored POS sale lines do not reconcile to the stored total", () => {
    expect(() =>
      buildStripeTerminalPaymentIntentRequest({ ...snapshot, totalCents: 9999 }, { attemptNonce: nonce })
    ).toThrow("Stored POS sale subtotal does not match sale total");

    expect(() =>
      buildStripeTerminalPaymentIntentRequest({ ...snapshot, subtotalCents: 9999 }, { attemptNonce: nonce })
    ).toThrow("Stored POS sale lines do not match sale subtotal");

    for (const line of [
      { name: "Bad", quantity: 0, unitAmountCents: 2000, lineTotalCents: 0 },
      { name: "Bad", quantity: 1, unitAmountCents: -1, lineTotalCents: -1 },
      { name: "Bad", quantity: 1.5, unitAmountCents: 1000, lineTotalCents: 1500 }
    ]) {
      expect(() =>
        buildStripeTerminalPaymentIntentRequest({ ...snapshot, lines: [...snapshot.lines, line] }, { attemptNonce: nonce })
      ).toThrow(/Stripe Terminal line/);
    }
    expect(() =>
      buildStripeTerminalPaymentIntentRequest(
        { ...snapshot, subtotalCents: 0, totalCents: 0, lines: [{ name: "Child", quantity: 1, unitAmountCents: 0, lineTotalCents: 0 }] },
        { attemptNonce: nonce }
      )
    ).toThrow("Stripe Terminal total must be at least 50 cents");
  });

  it("rejects booking-fee shaped POS sales", () => {
    expect(() =>
      buildStripeTerminalPaymentIntentRequest({ ...snapshot, feeCents: 405, totalCents: 7155 }, { attemptNonce: nonce })
    ).toThrow("Stripe Terminal POS sales do not support booking fees");
  });

  it("uses one idempotency key per frozen attempt and keeps the legacy key readable", () => {
    expect(stripeTerminalIntentIdempotencyKey("POS2607-ABC123")).toBe("skyla:terminal-intent:POS2607-ABC123");
    expect(stripeTerminalAttemptIdempotencyKey("POS2607-ABC123", nonce)).toBe(
      `skyla:terminal-intent:v2:POS2607-ABC123:${nonce}`
    );
    expect(() => stripeTerminalIntentIdempotencyKey("   ")).toThrow("saleRef is required");
    expect(() => stripeTerminalAttemptIdempotencyKey("POS2607-ABC123", "short")).toThrow("attemptNonce");
  });

  it("verifies exact mode, amount, currency, sale, nonce and capture before trusting an intent", () => {
    const expected = { saleRef: "POS2607-ABC123", amountCents: 3000, currency: "usd" as const, stripeMode: "test" as const, attemptNonce: nonce };
    const intent = {
      id: "pi_test12345678",
      object: "payment_intent",
      livemode: false,
      amount: 3000,
      amount_received: 0,
      currency: "usd",
      status: "requires_payment_method",
      capture_method: "automatic",
      payment_method_types: ["card_present"],
      metadata: { sale_ref: "POS2607-ABC123", source: "convex-terminal", attempt_nonce: nonce }
    };
    expect(verifyCreatedTerminalIntent(intent, expected)).toEqual({ ok: true, paymentIntentId: "pi_test12345678" });
    for (const [change, reason] of [
      [{ livemode: true }, "intent_livemode_mismatch"],
      [{ livemode: undefined }, "intent_livemode_missing"],
      [{ amount: 2999 }, "intent_amount_mismatch"],
      [{ currency: "eur" }, "intent_currency_mismatch"],
      [{ capture_method: "manual" }, "intent_capture_method_mismatch"],
      [{ metadata: { ...intent.metadata, sale_ref: "OTHER" } }, "intent_sale_mismatch"],
      [{ metadata: { ...intent.metadata, attempt_nonce: "f".repeat(32) } }, "intent_attempt_nonce_mismatch"],
      [{ status: "succeeded" }, "intent_not_new_at_creation"]
    ] as const) {
      expect(verifyCreatedTerminalIntent({ ...intent, ...change }, expected)).toEqual({ ok: false, reason });
    }

    expect(classifyRetrievedTerminalIntent({ ...intent, status: "succeeded", amount_received: 3000 }, expected))
      .toEqual({ state: "paid", paymentIntentId: "pi_test12345678" });
    expect(classifyRetrievedTerminalIntent({ ...intent, status: "succeeded", amount_received: 1000 }, expected))
      .toEqual({ state: "mismatch", reason: "intent_amount_received_mismatch" });
    // A decline leaves the same intent payable; it is never a cancellation.
    expect(classifyRetrievedTerminalIntent({ ...intent, last_payment_error: { decline_code: "card_declined" } }, expected))
      .toEqual({ state: "open", providerState: "requires_payment_method" });
    expect(classifyRetrievedTerminalIntent({ ...intent, status: "processing" }, expected))
      .toEqual({ state: "open", providerState: "processing" });
    expect(classifyRetrievedTerminalIntent({ ...intent, status: "canceled" }, expected))
      .toEqual({ state: "canceled", paymentIntentId: "pi_test12345678" });
    expect(classifyRetrievedTerminalIntent({ ...intent, status: "requires_capture" }, expected).state).toBe("unknown");
  });

  it("builds a server-driven reader process request for a stored reader and intent", () => {
    const request = buildStripeTerminalReaderProcessRequest({
      saleRef: "POS2607-ABC123",
      paymentIntentId: "pi_test_123",
      readerId: "tmr_test_123",
      processAttempt: 1,
      amountCents: 6750,
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
        amountCents: 6750,
        currency: "usd"
      })
    ).toThrow("Stripe Terminal reader id must look like tmr_");

    expect(() =>
      buildStripeTerminalReaderProcessRequest({
        saleRef: "POS2607-ABC123",
        paymentIntentId: "",
        readerId: "tmr_test_123",
        processAttempt: 1,
        amountCents: 6750,
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
