import { makeFunctionReference } from "convex/server";
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
  type StripeCheckoutSnapshot
} from "./lib/stripeCheckout";
import { configuredStripeSecret, stripeRequest } from "./lib/stripeHttp";
import {
  assertStripeTerminalReaderProcessResult,
  buildStripeTerminalPaymentIntentRequest,
  buildStripeTerminalReaderProcessRequest,
  sanitizeStripeTerminalReaderProcess,
  stripeTerminalReaderPaymentStatus,
  type StripeTerminalReaderProcessResponse,
  type StripeTerminalSnapshot
} from "./lib/stripeTerminal";
import { classifyTerminalReaderFailure, terminalPaymentStateError } from "./lib/terminalAttempts";
import { providerConfigurationFingerprint } from "./lib/providerIdentity";
import type { PosSaleStatus } from "./posStatus";
import {
  replayFrozenTerminalCreate,
  retrieveTerminalIntent,
  runClaimedTerminalWork,
  terminalProviderSecret,
  type TerminalAttemptView
} from "./terminalReconciliation";

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

const terminalPaymentContextQuery = makeFunctionReference<
  "query",
  { saleRef: string; idempotencyKey: string },
  | { kind: "attempt"; attempt: TerminalAttemptView }
  | { kind: "draft"; actorStaffUserId: Id<"staffUsers">; snapshot: StripeTerminalSnapshot & { readerId: string } }
>("terminalReconciliation:getTerminalPaymentContext");
const openTerminalAttemptMutation = makeFunctionReference<
  "mutation",
  {
    saleRef: string;
    idempotencyKey: string;
    attemptNonce: string;
    leaseToken: string;
    stripeMode: "test" | "live";
    providerConfigurationFingerprint: string;
    request: {
      apiVersion: string;
      providerIdempotencyKey: string;
      requestParams: Array<{ name: string; value: string }>;
      amountCents: number;
      currency: "usd";
      readerId: string;
      terminalLocationId?: string;
    };
  },
  { kind: "opened" | "existing"; attempt: TerminalAttemptView }
>("terminalReconciliation:openTerminalPaymentAttempt");
const claimTerminalCreateMutation = makeFunctionReference<
  "mutation",
  { attemptId: TerminalAttemptView["attemptId"]; leaseToken: string },
  | { kind: "claimed"; attempt: TerminalAttemptView }
  | { kind: "busy" | "window_closed" | "missing" }
  | { kind: "settled"; status: TerminalAttemptView["status"] }
>("terminalReconciliation:claimTerminalAttemptForCreate");
const recordTerminalCreateMutation = makeFunctionReference<
  "mutation",
  {
    attemptId: TerminalAttemptView["attemptId"];
    leaseToken: string;
    outcome:
      | { kind: "created"; providerPaymentIntentId: string; raw?: unknown }
      | { kind: "unknown" | "rejected" | "conflict" | "mismatch"; reason: string };
  },
  { status: TerminalAttemptView["status"]; stale?: boolean }
>("terminalReconciliation:recordTerminalCreateOutcome");
const claimTerminalReaderMutation = makeFunctionReference<
  "mutation",
  { saleRef: string; idempotencyKey: string },
  { attempt: TerminalAttemptView; processAttempt: number; processIdempotencyKey: string; actorStaffUserId: Id<"staffUsers"> }
>("terminalReconciliation:claimTerminalReaderProcess");
const recordTerminalReaderMutation = makeFunctionReference<
  "mutation",
  {
    attemptId: TerminalAttemptView["attemptId"];
    processAttempt: number;
    actorStaffUserId: Id<"staffUsers">;
    outcome:
      | { kind: "sent"; readerStatus: string; actionStatus: string; raw?: unknown }
      | { kind: "failed" | "unknown"; reason: string }
      | { kind: "skipped"; providerState: string };
  },
  { lastReaderStatus: string }
>("terminalReconciliation:recordTerminalReaderProcess");
const claimTerminalRefreshMutation = makeFunctionReference<
  "mutation",
  { saleRef: string; leaseToken: string },
  { kind: "retrieve" | "replay"; attempt: TerminalAttemptView } | { kind: "none" | "busy" } | null
>("terminalReconciliation:claimTerminalRefresh");
const posSaleStatusQuery = makeFunctionReference<"query", { saleRef: string }, PosSaleStatus>(
  "posStatus:getPosSaleStatus"
);

export type StripeTerminalStartResult = {
  saleRef: string;
  provider: "terminal";
  paymentIntentId: string;
  amountCents: number;
  currency: "usd";
  status: "open";
};

/**
 * Starts (or resumes) the sale's one PaymentIntent. The exact request, key,
 * amount, mode, nonce and credential identity are frozen, and the sale and
 * its hold move to payment_pending, before the first POST. A retry, double
 * click, reload or second device resumes the stored attempt.
 */
export const createStripeTerminalPaymentIntent = action({
  args: {
    saleRef: v.string(),
    idempotencyKey: v.string()
  },
  handler: async (ctx, args): Promise<StripeTerminalStartResult> => {
    assertPosTerminalAcceptanceEnabled();
    const context = await ctx.runQuery(terminalPaymentContextQuery, args);
    if (context.kind === "attempt") return resumeTerminalAttempt(ctx, context.attempt);

    // Credentials and the stored snapshot are checked before the sale leaves
    // draft, so a configuration failure never strands a payment_pending hold.
    const { secretKey, mode } = configuredStripeSecret();
    const attemptNonce = crypto.randomUUID().replaceAll("-", "").toLowerCase();
    const request = buildStripeTerminalPaymentIntentRequest(context.snapshot, { attemptNonce });
    const leaseToken = crypto.randomUUID();
    const opened = await ctx.runMutation(openTerminalAttemptMutation, {
      saleRef: args.saleRef,
      idempotencyKey: args.idempotencyKey,
      attemptNonce,
      leaseToken,
      stripeMode: mode,
      providerConfigurationFingerprint: await providerConfigurationFingerprint(["stripe", secretKey]),
      request: {
        apiVersion: request.apiVersion,
        providerIdempotencyKey: request.idempotencyKey,
        requestParams: [...request.body.entries()].map(([name, value]) => ({ name, value })),
        amountCents: context.snapshot.totalCents,
        currency: context.snapshot.currency,
        readerId: context.snapshot.readerId,
        ...(context.snapshot.terminalLocationId ? { terminalLocationId: context.snapshot.terminalLocationId } : {})
      }
    });
    if (opened.kind === "existing") return resumeTerminalAttempt(ctx, opened.attempt);
    return createFrozenTerminalIntent(ctx, opened.attempt, leaseToken, secretKey);
  }
});

function terminalStartResult(attempt: TerminalAttemptView, paymentIntentId: string): StripeTerminalStartResult {
  return {
    saleRef: attempt.saleRef,
    provider: "terminal",
    paymentIntentId,
    amountCents: attempt.amountCents,
    currency: attempt.currency,
    status: "open"
  };
}

async function resumeTerminalAttempt(ctx: ActionCtx, attempt: TerminalAttemptView): Promise<StripeTerminalStartResult> {
  const now = Date.now();
  switch (attempt.status) {
    case "open":
      return terminalStartResult(attempt, attempt.providerPaymentIntentId!);
    case "paid":
      throw terminalPaymentStateError("payment_already_received");
    case "canceled":
    case "rejected":
      throw terminalPaymentStateError("payment_closed");
    case "exception":
      throw terminalPaymentStateError("payment_needs_attention");
    case "creating":
    case "creation_unknown": {
      if (attempt.leaseExpiresAt !== undefined && attempt.leaseExpiresAt > now) {
        throw terminalPaymentStateError("payment_in_progress");
      }
      const secret = await terminalProviderSecret(attempt);
      // A changed credential or mode never replays into another merchant.
      if (!secret.ok) throw terminalPaymentStateError("payment_outcome_unknown");
      const leaseToken = crypto.randomUUID();
      const claim = await ctx.runMutation(claimTerminalCreateMutation, { attemptId: attempt.attemptId, leaseToken });
      if (claim.kind === "claimed") return createFrozenTerminalIntent(ctx, claim.attempt, leaseToken, secret.secretKey);
      if (claim.kind === "window_closed") throw terminalPaymentStateError("payment_needs_attention");
      throw terminalPaymentStateError("payment_in_progress");
    }
  }
}

/** Sends the stored request with its stored key; never builds a new one. */
async function createFrozenTerminalIntent(
  ctx: ActionCtx,
  attempt: TerminalAttemptView,
  leaseToken: string,
  secretKey: string
): Promise<StripeTerminalStartResult> {
  const result = await replayFrozenTerminalCreate(attempt, secretKey);
  if (result.state === "created") {
    const recorded = await ctx.runMutation(recordTerminalCreateMutation, {
      attemptId: attempt.attemptId,
      leaseToken,
      outcome: { kind: "created", providerPaymentIntentId: result.providerPaymentIntentId, raw: result.raw }
    });
    if (recorded.status === "open") return terminalStartResult(attempt, result.providerPaymentIntentId);
    if (recorded.status === "paid") throw terminalPaymentStateError("payment_already_received");
    throw terminalPaymentStateError("payment_needs_attention");
  }
  const recorded = await ctx.runMutation(recordTerminalCreateMutation, {
    attemptId: attempt.attemptId,
    leaseToken,
    outcome: { kind: result.kind, reason: result.reason }
  });
  // Unknown: Stripe may have created a payable intent. The hold stays and only
  // the same request with the same key is replayed; never charge twice.
  if (result.kind === "unknown") throw terminalPaymentStateError("payment_outcome_unknown");
  if (recorded.status === "rejected") throw new Error("Stripe Terminal rejected the payment request");
  throw terminalPaymentStateError("payment_needs_attention");
}

export type StripeTerminalProcessResult = {
  saleRef: string;
  provider: "terminal";
  paymentIntentId: string;
  readerId: string;
  amountCents: number;
  currency: "usd";
  status: "processing" | "failed";
  readerStatus: string;
  readerActionStatus: string;
};

/**
 * Hands the sale's one PaymentIntent to its stored reader. After a decline,
 * reader failure or timeout the same intent is presented again with a new
 * handoff key, but only after a provider read confirms it still needs a card.
 * A reader acknowledgement is never treated as payment.
 */
export const processStripeTerminalPaymentIntent = action({
  args: {
    saleRef: v.string(),
    idempotencyKey: v.string()
  },
  handler: async (ctx, args): Promise<StripeTerminalProcessResult> => {
    assertPosTerminalAcceptanceEnabled();
    const claim = await ctx.runMutation(claimTerminalReaderMutation, args);
    const { attempt, processAttempt } = claim;
    const paymentIntentId = attempt.providerPaymentIntentId!;
    const record = (
      outcome:
        | { kind: "sent"; readerStatus: string; actionStatus: string; raw?: unknown }
        | { kind: "failed" | "unknown"; reason: string }
        | { kind: "skipped"; providerState: string }
    ) =>
      ctx.runMutation(recordTerminalReaderMutation, {
        attemptId: attempt.attemptId,
        processAttempt,
        actorStaffUserId: claim.actorStaffUserId,
        outcome
      });

    const secret = await terminalProviderSecret(attempt);
    if (!secret.ok) {
      await record({ kind: "failed", reason: "provider_configuration_unavailable" });
      throw new Error("Stripe Terminal is not configured for this sale's frozen payment");
    }
    if (processAttempt > 1) {
      const current = await retrieveTerminalIntent(attempt, secret.secretKey);
      if (current.state !== "open" || current.providerState !== "requires_payment_method") {
        await record({ kind: "skipped", providerState: current.state === "open" ? current.providerState : current.state });
        throw terminalPaymentStateError("refresh_required");
      }
    }

    const request = buildStripeTerminalReaderProcessRequest({
      saleRef: attempt.saleRef,
      paymentIntentId,
      readerId: attempt.readerId,
      amountCents: attempt.amountCents,
      currency: attempt.currency,
      processAttempt
    });
    let response;
    try {
      response = await stripeRequest(request.endpoint, {
        method: "POST",
        secretKey: secret.secretKey,
        apiVersion: request.apiVersion,
        idempotencyKey: request.idempotencyKey,
        body: request.body
      });
    } catch {
      // A timeout or dropped connection may follow a card the reader took.
      await record({ kind: "unknown", reason: "network_error" });
      throw terminalPaymentStateError("payment_outcome_unknown");
    }
    if (!response.ok) {
      // Only a refusal Stripe made before the reader acted is a reader error;
      // terminal_reader_timeout and every other failure may hide a payment.
      const failure = classifyTerminalReaderFailure(response.status, response.body);
      await record(failure);
      throw terminalPaymentStateError(failure.kind === "failed" ? "reader_failed" : "payment_outcome_unknown");
    }
    const reader = (response.body && typeof response.body === "object" ? response.body : {}) as StripeTerminalReaderProcessResponse;
    try {
      if (reader.object !== "terminal.reader" || reader.id !== attempt.readerId) {
        throw new Error("Stripe returned a different Terminal reader");
      }
      assertStripeTerminalReaderProcessResult(reader, paymentIntentId);
    } catch {
      // Stripe answered, but not about this reader and intent: unknown.
      await record({ kind: "unknown", reason: "reader_response_mismatch" });
      throw terminalPaymentStateError("payment_outcome_unknown");
    }
    const status = stripeTerminalReaderPaymentStatus(reader);
    await record({
      kind: "sent",
      readerStatus: reader.status ?? "unknown",
      actionStatus: reader.action?.status ?? "unknown",
      raw: sanitizeStripeTerminalReaderProcess(reader)
    });
    return {
      saleRef: attempt.saleRef,
      provider: "terminal",
      paymentIntentId,
      readerId: attempt.readerId,
      amountCents: attempt.amountCents,
      currency: attempt.currency,
      status,
      readerStatus: reader.status ?? "unknown",
      readerActionStatus: reader.action?.status ?? "unknown"
    };
  }
});

/**
 * Staff Refresh Status: one bounded, leased GET of the sale's known intent
 * (or the exact frozen create replay inside its safe window), applied through
 * the same settlement as webhooks, then the authoritative stored status.
 */
export const refreshStripeTerminalPayment = action({
  args: { saleRef: v.string() },
  handler: async (ctx, args): Promise<PosSaleStatus & { refreshed: boolean }> => {
    const leaseToken = crypto.randomUUID();
    const claim = await ctx.runMutation(claimTerminalRefreshMutation, { saleRef: args.saleRef, leaseToken });
    let refreshed = false;
    if (claim && (claim.kind === "retrieve" || claim.kind === "replay")) {
      await runClaimedTerminalWork(ctx, claim, leaseToken);
      refreshed = true;
    }
    const status = await ctx.runQuery(posSaleStatusQuery, { saleRef: args.saleRef });
    return { ...status, refreshed };
  }
});

function assertPosTerminalAcceptanceEnabled() {
  if (process.env.SKYLA_POS_TERMINAL_ACCEPTANCE !== "enabled") {
    throw new Error("SKYLA_POS_TERMINAL_ACCEPTANCE is not enabled");
  }
}
