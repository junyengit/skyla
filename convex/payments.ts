import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import {
  assertStripeReturnOriginAllowed,
  buildStripeCheckoutSessionRequest,
  parseStripeReturnOriginAllowlist,
  sanitizeStripeCheckoutSession,
  stripeApiBaseUrl,
  stripeSessionErrorMessage,
  type StripeCheckoutSessionResponse,
  type StripeCheckoutSnapshot
} from "./lib/stripeCheckout";
import {
  buildStripeTerminalPaymentIntentRequest,
  sanitizeStripeTerminalPaymentIntent,
  stripeTerminalErrorMessage,
  type StripeTerminalPaymentIntentResponse,
  type StripeTerminalSnapshot
} from "./lib/stripeTerminal";

declare const process: { env: Record<string, string | undefined> };

export const createStripeCheckoutSession = action({
  args: {
    orderRef: v.string(),
    idempotencyKey: v.string(),
    successUrl: v.string(),
    cancelUrl: v.string()
  },
  handler: async (ctx, args) => {
    const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!secretKey) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    const allowedReturnOrigins = parseStripeReturnOriginAllowlist(process.env.SKYLA_PAYMENT_RETURN_ORIGINS);

    const snapshot: StripeCheckoutSnapshot = await ctx.runQuery(internal.paymentInternals.getCheckoutPaymentSnapshot, {
      orderRef: args.orderRef,
      idempotencyKey: args.idempotencyKey
    });
    const request = buildStripeCheckoutSessionRequest(snapshot, {
      successUrl: assertStripeReturnOriginAllowed(args.successUrl, "successUrl", allowedReturnOrigins),
      cancelUrl: assertStripeReturnOriginAllowed(args.cancelUrl, "cancelUrl", allowedReturnOrigins)
    });

    const session = await stripeFormPost<StripeCheckoutSessionResponse>(request.endpoint, {
      secretKey,
      apiVersion: request.apiVersion,
      idempotencyKey: request.idempotencyKey,
      body: request.body,
      errorMessage: stripeSessionErrorMessage
    });
    const sessionId = session.id;
    const sessionUrl = session.url;
    if (typeof sessionId !== "string" || !sessionId || typeof sessionUrl !== "string" || !sessionUrl) {
      throw new Error("Stripe did not return a checkout session URL");
    }
    if (session.amount_total !== undefined && session.amount_total !== snapshot.totalCents) {
      throw new Error("Stripe returned a checkout session for the wrong amount");
    }
    if (session.currency !== undefined && session.currency !== snapshot.currency) {
      throw new Error("Stripe returned a checkout session for the wrong currency");
    }

    await ctx.runMutation(internal.paymentInternals.recordStripeCheckoutSession, {
      orderRef: snapshot.orderRef,
      providerPaymentId: sessionId,
      idempotencyKey: request.idempotencyKey,
      amountCents: snapshot.totalCents,
      currency: snapshot.currency,
      raw: sanitizeStripeCheckoutSession(session)
    });

    return {
      orderRef: snapshot.orderRef,
      provider: "stripe" as const,
      checkoutSessionId: sessionId,
      url: sessionUrl,
      amountCents: snapshot.totalCents,
      currency: snapshot.currency
    };
  }
});

export const createStripeTerminalPaymentIntent = action({
  args: {
    saleRef: v.string(),
    idempotencyKey: v.string()
  },
  handler: async (ctx, args) => {
    const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!secretKey) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }

    const snapshot: StripeTerminalSnapshot & { actorStaffUserId: Id<"staffUsers"> } = await ctx.runQuery(
      internal.paymentInternals.getPosTerminalPaymentSnapshot,
      {
        saleRef: args.saleRef,
        idempotencyKey: args.idempotencyKey
      }
    );
    const request = buildStripeTerminalPaymentIntentRequest(snapshot);

    const intent = await stripeFormPost<StripeTerminalPaymentIntentResponse>(request.endpoint, {
      secretKey,
      apiVersion: request.apiVersion,
      idempotencyKey: request.idempotencyKey,
      body: request.body,
      errorMessage: stripeTerminalErrorMessage
    });
    const paymentIntentId = intent.id;
    if (typeof paymentIntentId !== "string" || !paymentIntentId) {
      throw new Error("Stripe did not return a Terminal PaymentIntent id");
    }
    const clientSecret = intent.client_secret;
    if (typeof clientSecret !== "string" || !clientSecret) {
      throw new Error("Stripe did not return a Terminal PaymentIntent client secret");
    }
    if (intent.amount !== undefined && intent.amount !== snapshot.totalCents) {
      throw new Error("Stripe returned a Terminal PaymentIntent for the wrong amount");
    }
    if (intent.currency !== undefined && intent.currency !== snapshot.currency) {
      throw new Error("Stripe returned a Terminal PaymentIntent for the wrong currency");
    }

    await ctx.runMutation(internal.paymentInternals.recordStripeTerminalPaymentIntent, {
      saleRef: snapshot.saleRef,
      providerPaymentId: paymentIntentId,
      idempotencyKey: request.idempotencyKey,
      amountCents: snapshot.totalCents,
      currency: snapshot.currency,
      actorStaffUserId: snapshot.actorStaffUserId,
      raw: sanitizeStripeTerminalPaymentIntent(intent)
    });

    return {
      saleRef: snapshot.saleRef,
      provider: "terminal" as const,
      paymentIntentId,
      clientSecret,
      amountCents: snapshot.totalCents,
      currency: snapshot.currency,
      status: intent.status ?? "requires_payment"
    };
  }
});

async function stripeFormPost<T extends { error?: { message?: string } }>(
  endpoint: string,
  options: {
    secretKey: string;
    apiVersion: string;
    idempotencyKey: string;
    body: URLSearchParams;
    errorMessage: (data: T) => string;
  }
): Promise<T> {
  const response = await fetch(`${stripeApiBaseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": options.idempotencyKey,
      "Stripe-Version": options.apiVersion
    },
    body: options.body
  });
  const data = (await response.json()) as T;
  if (!response.ok) {
    throw new Error(options.errorMessage(data));
  }
  return data;
}
