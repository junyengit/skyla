import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import {
  stripeCheckoutOutcomeFromEvent,
  verifyStripeWebhookSignature,
  type StripeWebhookEvent
} from "./lib/stripeWebhook";

declare const process: { env: Record<string, string | undefined> };

const http = httpRouter();

http.route({
  path: "/stripe-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const verification = await verifyStripeWebhookSignature(
      rawBody,
      request.headers.get("stripe-signature"),
      process.env.STRIPE_WEBHOOK_SECRET
    );
    if (!verification.ok) {
      return json(
        { ok: false, error: verification.reason },
        { status: verification.reason === "missing_secret" ? 500 : 401 }
      );
    }

    let event: StripeWebhookEvent;
    try {
      event = JSON.parse(rawBody) as StripeWebhookEvent;
    } catch {
      return json({ ok: false, error: "invalid_json" }, { status: 400 });
    }

    const outcome = stripeCheckoutOutcomeFromEvent(event);
    const result = await ctx.runMutation(
      internal.paymentInternals.recordStripeCheckoutWebhook,
      withoutUndefined({
        providerEventId: outcome.providerEventId,
        eventType: outcome.eventType,
        outcome: outcome.outcome,
        providerPaymentId: "providerPaymentId" in outcome ? outcome.providerPaymentId : undefined,
        orderRef: outcome.orderRef,
        amountCents: "amountCents" in outcome ? outcome.amountCents : undefined,
        currency: "currency" in outcome ? outcome.currency : undefined,
        raw: outcome.raw
      })
    );

    return json({
      ok: result.status !== "failed",
      status: result.status,
      duplicate: result.duplicate,
      orderRef: result.orderRef
    });
  })
});

http.route({
  path: "/stripe-webhook",
  method: "GET",
  handler: httpAction(async () => json({ ok: true, route: "stripe-webhook" }))
});

export default http;

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers
    }
  });
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
