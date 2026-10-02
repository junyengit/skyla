import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { action, internalAction, internalMutation, type ActionCtx } from "./_generated/server";
import { replayFrozenCreate, type CheckoutAttemptView } from "./checkoutReconciliation";
import {
  checkoutPaymentStateError,
  checkoutResumeMinRemainingMs,
  checkoutSessionLifetimeMs
} from "./lib/checkoutAttempts";
import { consumePublicGatewayRateLimit } from "./lib/publicGateway";
import {
  assertStripeReturnOriginAllowed,
  buildStripeCheckoutSessionRequest,
  parseStripeReturnOriginAllowlist,
  stripeApiBaseUrl,
  type StripeCheckoutSnapshot
} from "./lib/stripeCheckout";
import { configuredStripeSecret } from "./lib/stripeHttp";
import {
  assertStripeTerminalReaderProcessResult,
  buildStripeTerminalPaymentIntentRequest,
  buildStripeTerminalReaderProcessRequest,
  sanitizeStripeTerminalPaymentIntent,
  sanitizeStripeTerminalReaderProcess,
  stripeTerminalReaderErrorMessage,
  stripeTerminalReaderPaymentStatus,
  stripeTerminalErrorMessage,
  type StripeTerminalPaymentIntentResponse,
  type StripeTerminalProcessSnapshot,
  type StripeTerminalReaderProcessResponse,
  type StripeTerminalSnapshot
} from "./lib/stripeTerminal";
import { assertStripeSecretMode, parseStripeMode } from "./lib/stripeMode";
import { providerConfigurationFingerprint } from "./lib/providerIdentity";

declare const process: { env: Record<string, string | undefined> };

export const consumeStripeCheckoutRateLimit = internalMutation({
  args: { gatewayRateLimitKey: v.string() },
  handler: async (ctx, args) =>
    consumePublicGatewayRateLimit(ctx, "stripe-checkout", args.gatewayRateLimitKey)
});

export const createStripeCheckoutSession = internalAction({
  args: {
    gatewayRateLimitKey: v.string(),
    orderRef: v.string(),
    idempotencyKey: v.string(),
    legalAcceptance: v.object({
      termsAccepted: v.boolean(),
      termsVersion: v.string(),
      liabilityWaiverAccepted: v.boolean(),
      liabilityWaiverVersion: v.string()
    }),
    successUrl: v.string(),
    cancelUrl: v.string()
  },
  handler: async (ctx, args): Promise<StripeCheckoutStartResult> => {
    await ctx.runMutation(internal.payments.consumeStripeCheckoutRateLimit, {
      gatewayRateLimitKey: args.gatewayRateLimitKey
    });
    const context = await ctx.runQuery(internal.checkoutReconciliation.getCheckoutAttemptContext, {
      orderRef: args.orderRef,
      idempotencyKey: args.idempotencyKey
    });
    // One Session per order: a retry, double click or return visit resumes
    // the stored attempt instead of asking Stripe for another Session.
    if (context.kind === "attempt") {
      return resumeCheckoutAttempt(ctx, context.attempt);
    }
    if (context.kind === "legacy_pending") {
      const adopted = await ctx.runMutation(internal.checkoutReconciliation.adoptLegacyCheckoutSession, {
        orderRef: args.orderRef,
        idempotencyKey: args.idempotencyKey
      });
      if (adopted.kind === "exception") throw checkoutPaymentStateError("payment_needs_attention");
      return resumeCheckoutAttempt(ctx, adopted.attempt);
    }
    if (context.kind === "closed") {
      throw checkoutPaymentStateError(
        context.status === "paid" ? "payment_already_received" : "payment_session_closed"
      );
    }

    await ctx.runQuery(internal.orderDrafts.assertCheckoutOrderDraftActive, {
      orderRef: args.orderRef,
      idempotencyKey: args.idempotencyKey
    });
    await ctx.runMutation(internal.paymentInternals.recordCheckoutLegalAcceptance, {
      orderRef: args.orderRef,
      idempotencyKey: args.idempotencyKey,
      legalAcceptance: args.legalAcceptance
    });
    // Provider credentials, return origins, and the stored snapshot are all
    // checked before the order leaves draft, so a configuration failure never
    // strands a payment_pending hold without a Stripe attempt.
    const { secretKey, mode } = configuredStripeSecret();
    const allowedReturnOrigins = parseStripeReturnOriginAllowlist(process.env.SKYLA_PAYMENT_RETURN_ORIGINS);
    const successUrl = assertStripeReturnOriginAllowed(args.successUrl, "successUrl", allowedReturnOrigins);
    const cancelUrl = assertStripeReturnOriginAllowed(args.cancelUrl, "cancelUrl", allowedReturnOrigins);

    const snapshot: StripeCheckoutSnapshot = await ctx.runQuery(internal.paymentInternals.getCheckoutPaymentSnapshot, {
      orderRef: args.orderRef,
      idempotencyKey: args.idempotencyKey
    });
    const attemptNonce = crypto.randomUUID().replaceAll("-", "").toLowerCase();
    const request = buildStripeCheckoutSessionRequest(snapshot, { successUrl, cancelUrl }, {
      attemptNonce,
      expiresAt: Date.now() + checkoutSessionLifetimeMs
    });
    const leaseToken = crypto.randomUUID();

    // The exact request, key and expiry are stored, and the hold becomes
    // payment_pending, before the network call. An unknown result keeps the
    // hold; only a correlated provider outcome settles it.
    const opened = await ctx.runMutation(internal.checkoutReconciliation.openCheckoutSessionAttempt, {
      orderRef: args.orderRef,
      idempotencyKey: args.idempotencyKey,
      attemptNonce,
      leaseToken,
      stripeMode: mode,
      providerConfigurationFingerprint: await providerConfigurationFingerprint(["stripe", secretKey]),
      request: {
        endpoint: request.endpoint,
        apiVersion: request.apiVersion,
        providerIdempotencyKey: request.idempotencyKey,
        requestParams: [...request.body.entries()].map(([name, value]) => ({ name, value })),
        amountCents: snapshot.totalCents,
        currency: snapshot.currency,
        expiresAt: Number(request.body.get("expires_at")) * 1000,
        termsVersion: snapshot.termsVersion,
        liabilityWaiverVersion: snapshot.liabilityWaiverVersion
      }
    });
    if (opened.kind === "existing") {
      return resumeCheckoutAttempt(ctx, opened.attempt);
    }
    return createFrozenCheckoutSession(ctx, opened.attempt, leaseToken, secretKey);
  }
});

export type StripeCheckoutStartResult = {
  orderRef: string;
  provider: "stripe";
  checkoutSessionId: string;
  url: string;
  amountCents: number;
  currency: "usd";
  expiresAt: number;
};

function checkoutStartResult(attempt: CheckoutAttemptView, sessionId: string, url: string): StripeCheckoutStartResult {
  return {
    orderRef: attempt.orderRef,
    provider: "stripe",
    checkoutSessionId: sessionId,
    url,
    amountCents: attempt.amountCents,
    currency: attempt.currency,
    expiresAt: attempt.expiresAt
  };
}

async function resumeCheckoutAttempt(ctx: ActionCtx, attempt: CheckoutAttemptView): Promise<StripeCheckoutStartResult> {
  const now = Date.now();
  switch (attempt.status) {
    case "open":
      if (attempt.providerSessionId && attempt.providerSessionUrl && attempt.expiresAt - now > checkoutResumeMinRemainingMs) {
        return checkoutStartResult(attempt, attempt.providerSessionId, attempt.providerSessionUrl);
      }
      throw checkoutPaymentStateError("payment_session_expiring");
    case "paid":
      throw checkoutPaymentStateError("payment_already_received");
    case "expired":
    case "rejected":
      throw checkoutPaymentStateError("payment_session_closed");
    case "exception":
      throw checkoutPaymentStateError("payment_needs_attention");
    case "creating":
    case "creation_unknown": {
      if (attempt.leaseExpiresAt !== undefined && attempt.leaseExpiresAt > now) {
        throw checkoutPaymentStateError("payment_in_progress");
      }
      const { secretKey, mode } = configuredStripeSecret();
      if (mode !== attempt.stripeMode) {
        throw new Error("SKYLA_STRIPE_MODE does not match the stored checkout attempt");
      }
      const leaseToken = crypto.randomUUID();
      const claim = await ctx.runMutation(internal.checkoutReconciliation.claimCheckoutAttemptForCreate, {
        attemptId: attempt.attemptId,
        leaseToken
      });
      if (claim.kind === "claimed") return createFrozenCheckoutSession(ctx, claim.attempt, leaseToken, secretKey);
      if (claim.kind === "window_closed") throw checkoutPaymentStateError("payment_needs_attention");
      throw checkoutPaymentStateError("payment_in_progress");
    }
  }
}

/** Sends the stored request with its stored key; never builds a new one. */
async function createFrozenCheckoutSession(
  ctx: ActionCtx,
  attempt: CheckoutAttemptView,
  leaseToken: string,
  secretKey: string
): Promise<StripeCheckoutStartResult> {
  const result = await replayFrozenCreate(attempt, secretKey);
  if (result.state === "created") {
    const recorded = await ctx.runMutation(internal.checkoutReconciliation.recordCheckoutSessionCreateOutcome, {
      attemptId: attempt.attemptId,
      leaseToken,
      outcome: { kind: "created", providerSessionId: result.providerSessionId, url: result.url, raw: result.raw }
    });
    if (recorded.status === "open") {
      return checkoutStartResult(attempt, result.providerSessionId, result.url);
    }
    if (recorded.status === "paid") throw checkoutPaymentStateError("payment_already_received");
    throw checkoutPaymentStateError("payment_needs_attention");
  }
  const recorded = await ctx.runMutation(internal.checkoutReconciliation.recordCheckoutSessionCreateOutcome, {
    attemptId: attempt.attemptId,
    leaseToken,
    outcome: { kind: result.kind, reason: result.reason }
  });
  if (result.kind === "unknown") {
    // Stripe may have created a payable Session. The hold stays and the same
    // request is replayed with the same key; the guest must not pay twice.
    throw new Error("Stripe Checkout did not confirm the payment page; the order stays held");
  }
  if (recorded.status === "rejected") {
    throw new Error("Stripe Checkout rejected the payment request");
  }
  throw checkoutPaymentStateError("payment_needs_attention");
}

export const createStripeTerminalPaymentIntent = action({
  args: {
    saleRef: v.string(),
    idempotencyKey: v.string()
  },
  handler: async (ctx, args) => {
    assertPosTerminalAcceptanceEnabled();
    const secretKey = stripeSecretKey();

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
    if (typeof intent.client_secret !== "string" || !intent.client_secret) {
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
      amountCents: snapshot.totalCents,
      currency: snapshot.currency,
      status: intent.status ?? "requires_payment"
    };
  }
});

export const processStripeTerminalPaymentIntent = action({
  args: {
    saleRef: v.string(),
    idempotencyKey: v.string()
  },
  handler: async (ctx, args) => {
    assertPosTerminalAcceptanceEnabled();
    const secretKey = stripeSecretKey();

    const snapshot: StripeTerminalProcessSnapshot & { actorStaffUserId: Id<"staffUsers"> } =
      await ctx.runQuery(internal.paymentInternals.getStripeTerminalReaderProcessSnapshot, {
        saleRef: args.saleRef,
        idempotencyKey: args.idempotencyKey
      });
    const reservedAttempt = await ctx.runMutation(internal.paymentInternals.reserveStripeTerminalReaderProcessAttempt, {
      saleRef: snapshot.saleRef,
      providerPaymentId: snapshot.paymentIntentId,
      readerId: snapshot.readerId,
      amountCents: snapshot.amountCents,
      currency: snapshot.currency
    });
    const request = buildStripeTerminalReaderProcessRequest({
      ...snapshot,
      processAttempt: reservedAttempt.processAttempt
    });

    const reader = await stripeFormPost<StripeTerminalReaderProcessResponse>(request.endpoint, {
      secretKey,
      apiVersion: request.apiVersion,
      idempotencyKey: request.idempotencyKey,
      body: request.body,
      errorMessage: stripeTerminalReaderErrorMessage
    });
    const readerId = reader.id;
    if (typeof readerId !== "string" || !readerId) {
      throw new Error("Stripe did not return a Terminal reader id");
    }
    if (readerId !== snapshot.readerId) {
      throw new Error("Stripe returned a different Terminal reader");
    }
    assertStripeTerminalReaderProcessResult(reader, snapshot.paymentIntentId);
    const status = stripeTerminalReaderPaymentStatus(reader);

    await ctx.runMutation(internal.paymentInternals.recordStripeTerminalReaderProcess, {
      saleRef: snapshot.saleRef,
      providerPaymentId: snapshot.paymentIntentId,
      readerId: snapshot.readerId,
      amountCents: snapshot.amountCents,
      currency: snapshot.currency,
      processAttempt: reservedAttempt.processAttempt,
      processIdempotencyKey: reservedAttempt.processIdempotencyKey,
      status,
      actorStaffUserId: snapshot.actorStaffUserId,
      raw: sanitizeStripeTerminalReaderProcess(reader)
    });

    return {
      saleRef: snapshot.saleRef,
      provider: "terminal" as const,
      paymentIntentId: snapshot.paymentIntentId,
      readerId: snapshot.readerId,
      amountCents: snapshot.amountCents,
      currency: snapshot.currency,
      status,
      readerStatus: reader.status ?? "unknown",
      readerActionStatus: reader.action?.status ?? "unknown"
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

function stripeSecretKey() {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  assertStripeSecretMode(secretKey, parseStripeMode(process.env.SKYLA_STRIPE_MODE));
  return secretKey;
}

function assertPosTerminalAcceptanceEnabled() {
  if (process.env.SKYLA_POS_TERMINAL_ACCEPTANCE !== "enabled") {
    throw new Error("SKYLA_POS_TERMINAL_ACCEPTANCE is not enabled");
  }
}
