import { describe, expect, it } from "vitest";

import {
  stripeCheckoutOutcomeFromEvent,
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

describe("Stripe webhook helpers", () => {
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
    expect(stripeCheckoutOutcomeFromEvent(paidCheckoutEvent)).toMatchObject({
      outcome: "paid",
      providerEventId: "evt_checkout_paid_123",
      eventType: "checkout.session.completed",
      providerPaymentId: "cs_test_123",
      orderRef: "SKY2607-ABC123",
      amountCents: 8505,
      currency: "usd"
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
