import { describe, expect, it } from "vitest";

import {
  stripeCheckoutOrderStatusAfterUnpaidOutcome,
  stripeCheckoutOutcomeFromEvent,
  stripeRefundOutcomeFromEvent,
  stripeRefundWebhookDisposition,
  stripeTerminalPaymentIntentOutcomeFromEvent,
  stripeTerminalSaleStatusAfterUnpaidOutcome,
  stripeWebhookObjectType,
  stripeWebhookTestSignature,
  verifyStripeWebhookSignature,
  type StripeWebhookEvent
} from "./lib/stripeWebhook";

const nowSeconds = 1782860000;

const paidCheckoutEvent: StripeWebhookEvent = {
  id: "evt_checkout_paid_123",
  type: "checkout.session.completed",
  created: nowSeconds,
  livemode: false,
  data: {
    object: {
      id: "cs_test_123",
      object: "checkout.session",
      client_reference_id: "SKY2607-ABC123",
      amount_total: 8505,
      currency: "usd",
      payment_status: "paid",
      status: "complete",
      payment_intent: "pi_test_123",
      metadata: {
        order_ref: "SKY2607-ABC123",
        source: "convex"
      }
    }
  }
};

const paidTerminalEvent: StripeWebhookEvent = {
  id: "evt_terminal_paid_123",
  type: "payment_intent.succeeded",
  created: nowSeconds,
  livemode: false,
  data: {
    object: {
      id: "pi_terminal_123",
      object: "payment_intent",
      amount: 8550,
      currency: "usd",
      status: "succeeded",
      client_secret: "pi_terminal_123_secret_keep_out",
      latest_charge: "ch_terminal_123",
      metadata: {
        sale_ref: "POS2607-ABC123",
        source: "convex-terminal",
        line_count: "3",
        reader_id: "tmr_123",
        terminal_location_id: "tml_123"
      }
    }
  }
};

describe("Stripe webhook helpers", () => {
  it("returns a retryable HTTP status only while refund correlation is pending", () => {
    expect(stripeRefundWebhookDisposition("retryable")).toEqual({ ok: false, httpStatus: 503 });
    expect(stripeRefundWebhookDisposition("failed")).toEqual({ ok: false, httpStatus: 200 });
    expect(stripeRefundWebhookDisposition("processed")).toEqual({ ok: true, httpStatus: 200 });
  });

  it("verifies Stripe signatures over the exact raw body", async () => {
    const rawBody = JSON.stringify(paidCheckoutEvent);
    const secret = "whsec_test_secret";
    const signature = await stripeWebhookTestSignature(rawBody, secret, nowSeconds);

    await expect(
      verifyStripeWebhookSignature(rawBody, signature, secret, { nowMs: nowSeconds * 1000 })
    ).resolves.toEqual({ ok: true, timestamp: nowSeconds });

    await expect(
      verifyStripeWebhookSignature(`${rawBody}\n`, signature, secret, { nowMs: nowSeconds * 1000 })
    ).resolves.toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("rejects missing, malformed, stale, and mismatched signatures", async () => {
    const rawBody = JSON.stringify(paidCheckoutEvent);
    const signature = await stripeWebhookTestSignature(rawBody, "whsec_test_secret", nowSeconds);

    await expect(verifyStripeWebhookSignature(rawBody, signature, undefined)).resolves.toEqual({
      ok: false,
      reason: "missing_secret"
    });
    await expect(verifyStripeWebhookSignature(rawBody, null, "whsec_test_secret")).resolves.toEqual({
      ok: false,
      reason: "missing_header"
    });
    await expect(verifyStripeWebhookSignature(rawBody, "t=bad,v1=nope", "whsec_test_secret")).resolves.toEqual({
      ok: false,
      reason: "malformed_header"
    });
    await expect(
      verifyStripeWebhookSignature(rawBody, signature, "whsec_test_secret", {
        nowMs: (nowSeconds + 600) * 1000
      })
    ).resolves.toEqual({
      ok: false,
      reason: "timestamp_outside_tolerance"
    });
  });

  it("extracts a paid Checkout Session outcome from stored-order metadata", () => {
    expect(stripeWebhookObjectType(paidCheckoutEvent)).toBe("checkout.session");
    expect(stripeCheckoutOutcomeFromEvent(paidCheckoutEvent)).toMatchObject({
      outcome: "paid",
      providerEventId: "evt_checkout_paid_123",
      eventType: "checkout.session.completed",
      providerPaymentId: "cs_test_123",
      providerPaymentIntentId: "pi_test_123",
      orderRef: "SKY2607-ABC123",
      amountCents: 8505,
      currency: "usd"
    });
  });

  it("extracts a sanitized Stripe refund outcome", () => {
    const event: StripeWebhookEvent = {
      id: "evt_refund_123",
      type: "refund.updated",
      created: nowSeconds,
      livemode: false,
      data: {
        object: {
          id: "re_123",
          object: "refund",
          payment_intent: "pi_test_123",
          amount: 2500,
          currency: "usd",
          status: "succeeded",
          reason: "requested_by_customer",
          created: nowSeconds - 30,
          metadata: { private_note: "do not retain" }
        }
      }
    };
    expect(stripeWebhookObjectType(event)).toBe("refund");
    const outcome = stripeRefundOutcomeFromEvent(event);
    expect(outcome).toMatchObject({
      outcome: "refund",
      providerEventId: "evt_refund_123",
      providerRefundId: "re_123",
      providerPaymentIntentId: "pi_test_123",
      status: "succeeded",
      amountCents: 2500,
      currency: "usd",
      providerEventCreatedAt: nowSeconds * 1000
    });
    expect(JSON.stringify(outcome.raw)).not.toContain("private_note");
  });

  it("ignores malformed refunds and failed events with contradictory status", () => {
    expect(
      stripeRefundOutcomeFromEvent({
        id: "evt_refund_missing_pi",
        type: "refund.created",
        created: nowSeconds,
        data: { object: { id: "re_missing", object: "refund", amount: 100, currency: "usd", status: "pending" } }
      })
    ).toMatchObject({ outcome: "ignored", providerEventId: "evt_refund_missing_pi" });
    expect(
      stripeRefundOutcomeFromEvent({
        id: "evt_refund_failed_mismatch",
        type: "refund.failed",
        created: nowSeconds,
        data: {
          object: {
            id: "re_failed",
            object: "refund",
            payment_intent: "pi_test_123",
            amount: 100,
            currency: "usd",
            status: "succeeded"
          }
        }
      })
    ).toMatchObject({ outcome: "ignored", providerEventId: "evt_refund_failed_mismatch" });
    expect(
      stripeRefundOutcomeFromEvent({
        id: "evt_refund_fractional_amount",
        type: "refund.updated",
        created: nowSeconds,
        data: {
          object: {
            id: "re_fractional",
            object: "refund",
            payment_intent: "pi_test_123",
            amount: 10.5,
            currency: "usd",
            status: "pending"
          }
        }
      })
    ).toMatchObject({ outcome: "ignored", providerEventId: "evt_refund_fractional_amount" });
    expect(
      stripeRefundOutcomeFromEvent({
        id: "evt_refund_invalid_timestamp",
        type: "refund.updated",
        created: -1,
        data: {
          object: {
            id: "re_invalid_timestamp",
            object: "refund",
            payment_intent: "pi_test_123",
            amount: 100,
            currency: "usd",
            status: "pending"
          }
        }
      })
    ).toMatchObject({ outcome: "ignored", providerEventId: "evt_refund_invalid_timestamp" });
  });

  it("extracts a paid Terminal PaymentIntent outcome from stored-sale metadata", () => {
    expect(stripeWebhookObjectType(paidTerminalEvent)).toBe("payment_intent");
    const outcome = stripeTerminalPaymentIntentOutcomeFromEvent(paidTerminalEvent);

    expect(outcome).toMatchObject({
      outcome: "paid",
      providerEventId: "evt_terminal_paid_123",
      eventType: "payment_intent.succeeded",
      providerPaymentId: "pi_terminal_123",
      saleRef: "POS2607-ABC123",
      amountCents: 8550,
      currency: "usd"
    });
    expect(JSON.stringify(outcome.raw)).not.toContain("client_secret");
  });

  it("maps unpaid Checkout outcomes to terminal order states", () => {
    expect(stripeCheckoutOrderStatusAfterUnpaidOutcome("failed")).toBe("canceled");
    expect(stripeCheckoutOrderStatusAfterUnpaidOutcome("canceled")).toBe("expired");
  });

  it("maps unpaid Terminal outcomes without downgrading retryable failures to canceled", () => {
    expect(stripeTerminalSaleStatusAfterUnpaidOutcome("failed")).toBe("payment_pending");
    expect(stripeTerminalSaleStatusAfterUnpaidOutcome("canceled")).toBe("canceled");
  });

  it("extracts failed and canceled Terminal PaymentIntent outcomes", () => {
    expect(
      stripeTerminalPaymentIntentOutcomeFromEvent({
        ...paidTerminalEvent,
        id: "evt_terminal_failed_123",
        type: "payment_intent.payment_failed",
        data: {
          object: {
            ...(paidTerminalEvent.data?.object as Record<string, unknown>),
            status: "requires_payment_method"
          }
        }
      })
    ).toMatchObject({
      outcome: "failed",
      providerEventId: "evt_terminal_failed_123",
      providerPaymentId: "pi_terminal_123",
      saleRef: "POS2607-ABC123"
    });

    expect(
      stripeTerminalPaymentIntentOutcomeFromEvent({
        ...paidTerminalEvent,
        id: "evt_terminal_canceled_123",
        type: "payment_intent.canceled",
        data: {
          object: {
            ...(paidTerminalEvent.data?.object as Record<string, unknown>),
            status: "canceled"
          }
        }
      })
    ).toMatchObject({
      outcome: "canceled",
      providerEventId: "evt_terminal_canceled_123",
      providerPaymentId: "pi_terminal_123",
      saleRef: "POS2607-ABC123"
    });
  });

  it("ignores Terminal PaymentIntent events without Convex sale authority", () => {
    expect(
      stripeTerminalPaymentIntentOutcomeFromEvent({
        ...paidTerminalEvent,
        data: {
          object: {
            ...(paidTerminalEvent.data?.object as Record<string, unknown>),
            metadata: {
              sale_ref: "POS2607-ABC123",
              source: "other-system"
            }
          }
        }
      })
    ).toMatchObject({
      outcome: "ignored",
      providerEventId: "evt_terminal_paid_123",
      saleRef: "POS2607-ABC123"
    });

    expect(
      stripeTerminalPaymentIntentOutcomeFromEvent({
        ...paidTerminalEvent,
        data: {
          object: {
            ...(paidTerminalEvent.data?.object as Record<string, unknown>),
            metadata: {
              source: "convex-terminal"
            }
          }
        }
      })
    ).toMatchObject({
      outcome: "ignored",
      providerEventId: "evt_terminal_paid_123"
    });
  });

  it("ignores unpaid, unsupported, and malformed events", () => {
    expect(
      stripeCheckoutOutcomeFromEvent({
        ...paidCheckoutEvent,
        data: {
          object: {
            ...(paidCheckoutEvent.data?.object as Record<string, unknown>),
            payment_status: "unpaid"
          }
        }
      })
    ).toMatchObject({
      outcome: "ignored",
      providerEventId: "evt_checkout_paid_123",
      eventType: "checkout.session.completed",
      orderRef: "SKY2607-ABC123"
    });

    expect(stripeCheckoutOutcomeFromEvent({ id: "evt_other_123", type: "payment_intent.succeeded" })).toMatchObject({
      outcome: "ignored",
      providerEventId: "evt_other_123",
      eventType: "payment_intent.succeeded"
    });

    expect(stripeCheckoutOutcomeFromEvent({})).toMatchObject({
      outcome: "ignored",
      providerEventId: "missing_event_id",
      eventType: "unknown"
    });
  });
});
