import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx
} from "./_generated/server";
import { releaseUnpaidCapacityHold } from "./lib/capacity";
import {
  checkoutAttemptLeaseMs,
  checkoutConfigMaxAttempts,
  checkoutCreateMaxProviderRequests,
  checkoutExpiryReconcileMarginMs,
  checkoutPaymentStateError,
  checkoutReconcileMaxAttempts,
  checkoutReplayWindowEndsAt,
  checkoutSessionLifetimeMs,
  classifyRetrievedCheckoutSession,
  classifyStripeCreateFailure,
  configBackoffMs,
  reconcileBackoffMs,
  stripeMinimumSessionLifetimeMs,
  verifyCreatedCheckoutSession,
  type CheckoutSessionExpectation
} from "./lib/checkoutAttempts";
import {
  patchCheckoutAttempt,
  redactedRequestParams,
  settleCheckoutPaid,
  settleCheckoutUnpaid
} from "./lib/checkoutSettlement";
import { openOperationsException, resolveOperationsException } from "./lib/operationsExceptions";
import { normalizeIdempotencyKey } from "./lib/orderDraftPersistence";
import { moveCheckoutOrderToPaymentPending, findCheckoutOrderForPayment } from "./orderDrafts";
import {
  sanitizeStripeCheckoutSession,
  stripeApiVersion,
  stripeCheckoutAttemptIdempotencyKey,
  type StripeCheckoutSessionResponse
} from "./lib/stripeCheckout";
import { configuredStripeSecret, stripeRequest } from "./lib/stripeHttp";
import { newTicketCode } from "./lib/ticketDelivery";
import { providerConfigurationFingerprint } from "./lib/providerIdentity";

type AttemptDoc = Doc<"checkoutPaymentAttempts">;
type AttemptId = Id<"checkoutPaymentAttempts">;

/** What an action needs to replay, verify or retrieve one attempt. */
export type CheckoutAttemptView = {
  attemptId: AttemptId;
  orderRef: string;
  attemptNonce: string;
  legacy: boolean;
  status: AttemptDoc["status"];
  stripeMode: AttemptDoc["stripeMode"];
  providerConfigurationFingerprint?: string;
  apiVersion: string;
  endpoint: string;
  providerIdempotencyKey: string;
  requestParams: Array<{ name: string; value: string }>;
  amountCents: number;
  currency: "usd";
  expiresAt: number;
  createdAt: number;
  providerSessionId?: string;
  providerSessionUrl?: string;
  leaseExpiresAt?: number;
  version: number;
};

const reconcileCheckoutAttemptAction = makeFunctionReference<
  "action",
  { attemptId: AttemptId },
  null
>("checkoutReconciliation:reconcileCheckoutAttempt");

const frozenRequest = v.object({
  endpoint: v.literal("/checkout/sessions"),
  apiVersion: v.string(),
  providerIdempotencyKey: v.string(),
  requestParams: v.array(v.object({ name: v.string(), value: v.string() })),
  amountCents: v.number(),
  currency: v.literal("usd"),
  expiresAt: v.number(),
  termsVersion: v.string(),
  liabilityWaiverVersion: v.string()
});

const sanitizedSession = v.optional(v.any());

export function attemptView(attempt: AttemptDoc): CheckoutAttemptView {
  return {
    attemptId: attempt._id,
    orderRef: attempt.orderRef,
    attemptNonce: attempt.attemptNonce,
    legacy: attempt.legacy === true,
    status: attempt.status,
    stripeMode: attempt.stripeMode,
    providerConfigurationFingerprint: attempt.providerConfigurationFingerprint,
    apiVersion: attempt.apiVersion,
    endpoint: attempt.endpoint,
    providerIdempotencyKey: attempt.providerIdempotencyKey,
    requestParams: attempt.requestParams,
    amountCents: attempt.amountCents,
    currency: attempt.currency,
    expiresAt: attempt.expiresAt,
    createdAt: attempt.createdAt,
    providerSessionId: attempt.providerSessionId,
    providerSessionUrl: attempt.providerSessionUrl,
    leaseExpiresAt: attempt.leaseExpiresAt,
    version: attempt.version
  };
}

export function attemptExpectation(attempt: CheckoutAttemptView, withExpiry: boolean): CheckoutSessionExpectation {
  return {
    orderRef: attempt.orderRef,
    amountCents: attempt.amountCents,
    currency: attempt.currency,
    stripeMode: attempt.stripeMode,
    attemptNonce: attempt.legacy ? undefined : attempt.attemptNonce,
    providerSessionId: attempt.providerSessionId,
    expiresAt: withExpiry && !attempt.legacy ? attempt.expiresAt : undefined
  };
}

async function findAttemptForOrder(ctx: QueryCtx | MutationCtx, orderRef: string) {
  return ctx.db
    .query("checkoutPaymentAttempts")
    .withIndex("by_orderRef", (q) => q.eq("orderRef", orderRef))
    .first();
}

const creationEvidenceLimit = 50;

async function legacySessionCreation(ctx: QueryCtx | MutationCtx, orderRef: string) {
  // Failed webhook history must not grow the hot recovery read. An overflowing
  // creation subset is ambiguous, so leave the order held for staff review.
  const events = await ctx.db.query("paymentEvents")
    .withIndex("by_orderRef_status", q => q.eq("orderRef", orderRef).eq("status", "created"))
    .take(creationEvidenceLimit + 1);
  return events.length <= creationEvidenceLimit
    ? events.find(event => event.provider === "stripe")
    : undefined;
}

async function scheduleReconcile(ctx: MutationCtx, attemptId: AttemptId, reconcileAt: number) {
  await ctx.scheduler.runAt(reconcileAt, reconcileCheckoutAttemptAction, { attemptId });
}

/** Moves an attempt to a visible exception; its capacity hold is kept. */
async function markAttemptException(
  ctx: MutationCtx,
  attempt: AttemptDoc,
  code: string,
  now: number,
  evidence: Record<string, string | number | boolean | undefined> = {}
) {
  await patchCheckoutAttempt(ctx, attempt, {
    status: "exception",
    exceptionReason: code,
    lastError: attempt.lastError,
    reconcileAt: undefined,
    leaseToken: undefined,
    leaseExpiresAt: undefined
  }, now);
  await openOperationsException(ctx, {
    category: "checkout_attempt",
    code,
    dedupeKey: `checkout_attempt:${code}:${attempt.orderRef}:${attempt.attemptNonce}`,
    // Unknown: the Session may exist and may have been paid.
    moneyReceived: false,
    orderRef: attempt.orderRef,
    providerSessionId: attempt.providerSessionId,
    amountCents: attempt.amountCents,
    currency: attempt.currency,
    evidence: {
      attemptStatus: attempt.status,
      providerRequestCount: attempt.providerRequestCount,
      reconcileCount: attempt.reconcileCount,
      lastError: attempt.lastError,
      ...evidence
    },
    now
  });
}

/** The state the gateway action needs before it decides to call Stripe. */
export const getCheckoutAttemptContext = internalQuery({
  args: { orderRef: v.string(), idempotencyKey: v.string() },
  handler: async (ctx, args): Promise<
    | { kind: "attempt"; attempt: CheckoutAttemptView }
    | { kind: "legacy_pending"; created?: { sessionId: string; url?: string; createdAt: number } }
    | { kind: "draft" }
    | { kind: "closed"; status: string }
  > => {
    const order = await ctx.db
      .query("orders")
      .withIndex("by_orderRef", (q) => q.eq("orderRef", args.orderRef))
      .unique();
    if (!order || order.channel !== "online" || order.idempotencyKey !== normalizeIdempotencyKey(args.idempotencyKey)) {
      throw new Error("Checkout order was not found for this payment attempt");
    }
    const attempt = await findAttemptForOrder(ctx, order.orderRef);
    if (attempt) return { kind: "attempt", attempt: attemptView(attempt) };
    if (order.status === "draft") return { kind: "draft" };
    if (order.status !== "payment_pending") return { kind: "closed", status: order.status };
    const created = await legacySessionCreation(ctx, order.orderRef);
    const raw = created?.raw && typeof created.raw === "object" ? (created.raw as { url?: unknown }) : {};
    return {
      kind: "legacy_pending",
      ...(created
        ? {
            created: {
              sessionId: created.providerPaymentId,
              url: typeof raw.url === "string" ? raw.url : undefined,
              createdAt: created.createdAt
            }
          }
        : {})
    };
  }
});

/**
 * Freezes the exact Stripe request and moves the order and its hold to
 * payment_pending in one transaction, before any network call. Concurrent
 * starts for the same order get the one existing attempt back.
 */
export const openCheckoutSessionAttempt = internalMutation({
  args: {
    orderRef: v.string(),
    idempotencyKey: v.string(),
    attemptNonce: v.string(),
    leaseToken: v.string(),
    stripeMode: v.union(v.literal("test"), v.literal("live")),
    providerConfigurationFingerprint: v.string(),
    request: frozenRequest
  },
  handler: async (ctx, args): Promise<
    { kind: "opened"; attempt: CheckoutAttemptView } | { kind: "existing"; attempt: CheckoutAttemptView }
  > => {
    const order = await findCheckoutOrderForPayment(ctx, args);
    const existing = await findAttemptForOrder(ctx, order.orderRef);
    if (existing) return { kind: "existing", attempt: attemptView(existing) };
    if (order.status !== "draft") {
      // payment_pending without an attempt predates frozen attempts; it is
      // never given a second Session.
      throw checkoutPaymentStateError("payment_needs_attention");
    }

    const now = Date.now();
    const { request } = args;
    if (!/^[a-f0-9]{64}$/.test(args.providerConfigurationFingerprint)) {
      throw new Error("Checkout provider configuration identity is invalid");
    }
    const param = (name: string) => request.requestParams.find((entry) => entry.name === name)?.value;
    if (
      request.apiVersion !== stripeApiVersion ||
      request.amountCents !== order.totalCents ||
      request.currency !== order.currency ||
      request.providerIdempotencyKey !== stripeCheckoutAttemptIdempotencyKey(order.orderRef, args.attemptNonce) ||
      param("client_reference_id") !== order.orderRef ||
      param("metadata[attempt_nonce]") !== args.attemptNonce ||
      param("expires_at") !== String(Math.floor(request.expiresAt / 1000)) ||
      param("mode") !== "payment"
    ) {
      throw new Error("Checkout attempt request does not match the stored order");
    }
    if (
      request.expiresAt - now < stripeMinimumSessionLifetimeMs + 5 * 60 * 1000 ||
      request.expiresAt - now > checkoutSessionLifetimeMs
    ) {
      throw new Error("Checkout attempt expiry is out of date");
    }

    await moveCheckoutOrderToPaymentPending(ctx, order, now);
    const reconcileAt = now + checkoutAttemptLeaseMs + 30_000;
    const attemptId = await ctx.db.insert("checkoutPaymentAttempts", {
      orderRef: order.orderRef,
      attemptNonce: args.attemptNonce,
      stripeMode: args.stripeMode,
      providerConfigurationFingerprint: args.providerConfigurationFingerprint,
      apiVersion: request.apiVersion,
      endpoint: request.endpoint,
      providerIdempotencyKey: request.providerIdempotencyKey,
      requestParams: request.requestParams,
      amountCents: request.amountCents,
      currency: request.currency,
      expiresAt: request.expiresAt,
      termsVersion: request.termsVersion,
      liabilityWaiverVersion: request.liabilityWaiverVersion,
      status: "creating",
      providerRequestCount: 1,
      firstProviderRequestAt: now,
      lastProviderRequestAt: now,
      leaseToken: args.leaseToken,
      leaseExpiresAt: now + checkoutAttemptLeaseMs,
      version: 1,
      // Safety net: if the action dies mid-request, reconciliation replays it.
      reconcileAt,
      reconcileCount: 0,
      createdAt: now,
      updatedAt: now
    });
    await scheduleReconcile(ctx, attemptId, reconcileAt);
    const attempt = (await ctx.db.get(attemptId))!;
    return { kind: "opened", attempt: attemptView(attempt) };
  }
});

/** Leases an unknown-outcome attempt for a replay of its exact frozen request. */
export const claimCheckoutAttemptForCreate = internalMutation({
  args: { attemptId: v.id("checkoutPaymentAttempts"), leaseToken: v.string() },
  handler: async (ctx, args): Promise<
    | { kind: "claimed"; attempt: CheckoutAttemptView }
    | { kind: "busy" | "window_closed" | "missing" }
    | { kind: "settled"; status: AttemptDoc["status"] }
  > => {
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) return { kind: "missing" };
    const now = Date.now();
    const claim = await claimReplay(ctx, attempt, args.leaseToken, now);
    if (claim === "claimed") return { kind: "claimed", attempt: attemptView((await ctx.db.get(args.attemptId))!) };
    if (claim === "settled") return { kind: "settled", status: attempt.status };
    return { kind: claim };
  }
});

async function claimReplay(
  ctx: MutationCtx,
  attempt: AttemptDoc,
  leaseToken: string,
  now: number
): Promise<"claimed" | "busy" | "window_closed" | "settled"> {
  if (attempt.status !== "creating" && attempt.status !== "creation_unknown") return "settled";
  if (attempt.leaseExpiresAt !== undefined && attempt.leaseExpiresAt > now) return "busy";
  if (now >= checkoutReplayWindowEndsAt(attempt) || attempt.providerRequestCount >= checkoutCreateMaxProviderRequests) {
    // Beyond this point a replay could create a second Session (expired or
    // pruned key) or fail Stripe's expiry minimum; staff must reconcile.
    await markAttemptException(ctx, attempt, "checkout_session_creation_outcome_unknown", now);
    return "window_closed";
  }
  await patchCheckoutAttempt(ctx, attempt, {
    status: "creating",
    leaseToken,
    leaseExpiresAt: now + checkoutAttemptLeaseMs,
    providerRequestCount: attempt.providerRequestCount + 1,
    lastProviderRequestAt: now,
    reconcileAt: now + checkoutAttemptLeaseMs + 30_000
  }, now);
  return "claimed";
}

type CreateOutcome =
  | { kind: "created"; providerSessionId: string; url: string; raw?: unknown }
  | { kind: "unknown" | "rejected" | "conflict" | "mismatch"; reason: string };

async function applyCreateOutcome(
  ctx: MutationCtx,
  attempt: AttemptDoc,
  leaseToken: string,
  outcome: CreateOutcome,
  now: number
) {
  const holdsLease = attempt.leaseToken === leaseToken;
  if (outcome.kind === "created") {
    if (attempt.providerSessionId && attempt.providerSessionId !== outcome.providerSessionId) {
      await markAttemptException(ctx, attempt, "checkout_attempt_two_sessions", now, {
        returnedSessionId: outcome.providerSessionId
      });
      return { status: "exception" as const };
    }
    const stillCreating = attempt.status === "creating" || attempt.status === "creation_unknown";
    const reconcileAt = attempt.expiresAt + checkoutExpiryReconcileMarginMs;
    await patchCheckoutAttempt(ctx, attempt, {
      providerSessionId: outcome.providerSessionId,
      providerSessionUrl: outcome.url,
      ...(stillCreating ? { status: "open" as const, reconcileAt, lastError: undefined } : {}),
      ...(holdsLease ? { leaseToken: undefined, leaseExpiresAt: undefined } : {})
    }, now);
    const created = await ctx.db
      .query("paymentEvents")
      .withIndex("by_provider_providerPaymentId_status", (q) =>
        q.eq("provider", "stripe").eq("providerPaymentId", outcome.providerSessionId).eq("status", "created")
      )
      .take(creationEvidenceLimit + 1);
    if (created.length > creationEvidenceLimit) {
      await markAttemptException(ctx, attempt, "checkout_creation_evidence_overflow", now);
      return { status: "exception" as const };
    }
    if (!created.some((event) => event.orderRef === attempt.orderRef && event.status === "created")) {
      await ctx.db.insert("paymentEvents", {
        orderRef: attempt.orderRef,
        provider: "stripe",
        providerPaymentId: outcome.providerSessionId,
        idempotencyKey: attempt.providerIdempotencyKey,
        status: "created",
        currency: attempt.currency,
        amountCents: attempt.amountCents,
        raw: outcome.raw,
        createdAt: now
      });
    }
    if (stillCreating) await scheduleReconcile(ctx, attempt._id, reconcileAt);
    return { status: stillCreating ? ("open" as const) : attempt.status };
  }

  if (!holdsLease || (attempt.status !== "creating" && attempt.status !== "creation_unknown")) {
    return { status: attempt.status, stale: true };
  }

  if (outcome.kind === "unknown") {
    const windowEnd = checkoutReplayWindowEndsAt(attempt);
    if (now >= windowEnd || attempt.providerRequestCount >= checkoutCreateMaxProviderRequests) {
      await markAttemptException(ctx, { ...attempt, lastError: outcome.reason }, "checkout_session_creation_outcome_unknown", now);
      return { status: "exception" as const };
    }
    const reconcileAt = Math.min(now + reconcileBackoffMs(attempt.providerRequestCount - 1), windowEnd - 1000);
    await patchCheckoutAttempt(ctx, attempt, {
      status: "creation_unknown",
      lastError: outcome.reason,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      reconcileAt
    }, now);
    await scheduleReconcile(ctx, attempt._id, reconcileAt);
    return { status: "creation_unknown" as const };
  }

  if (outcome.kind === "rejected" && attempt.providerRequestCount === 1) {
    // The only request ever sent with this key was refused by Stripe, so no
    // Session exists and the unpaid hold can be released.
    await patchCheckoutAttempt(ctx, attempt, {
      status: "rejected",
      lastError: outcome.reason,
      requestParams: redactedRequestParams(attempt.requestParams),
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      reconcileAt: undefined,
      settledAt: now
    }, now);
    const order = await ctx.db
      .query("orders")
      .withIndex("by_orderRef", (q) => q.eq("orderRef", attempt.orderRef))
      .unique();
    if (order?.status === "payment_pending") {
      await ctx.db.patch(order._id, { status: "canceled", updatedAt: now });
      await releaseUnpaidCapacityHold(ctx, attempt.orderRef, "stripe_creation_rejected", now);
    }
    await openOperationsException(ctx, {
      category: "checkout_attempt",
      code: "checkout_session_creation_rejected",
      dedupeKey: `checkout_attempt:checkout_session_creation_rejected:${attempt.orderRef}:${attempt.attemptNonce}`,
      moneyReceived: false,
      orderRef: attempt.orderRef,
      amountCents: attempt.amountCents,
      currency: attempt.currency,
      evidence: { reason: outcome.reason },
      now
    });
    return { status: "rejected" as const };
  }

  await markAttemptException(ctx, { ...attempt, lastError: outcome.reason }, `checkout_session_creation_${outcome.kind}`, now, {
    reason: outcome.reason
  });
  return { status: "exception" as const };
}

export const recordCheckoutSessionCreateOutcome = internalMutation({
  args: {
    attemptId: v.id("checkoutPaymentAttempts"),
    leaseToken: v.string(),
    outcome: v.union(
      v.object({
        kind: v.literal("created"),
        providerSessionId: v.string(),
        url: v.string(),
        raw: sanitizedSession
      }),
      v.object({
        kind: v.union(v.literal("unknown"), v.literal("rejected"), v.literal("conflict"), v.literal("mismatch")),
        reason: v.string()
      })
    )
  },
  handler: async (ctx, args): Promise<{ status: AttemptDoc["status"]; stale?: boolean }> => {
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) throw new Error("Checkout attempt was not found");
    return applyCreateOutcome(ctx, attempt, args.leaseToken, args.outcome as CreateOutcome, Date.now());
  }
});

/**
 * Adopts a Session created before frozen attempts so reconciliation can
 * retrieve it. Its original request was never stored, so it is never replayed.
 */
export const adoptLegacyCheckoutSession = internalMutation({
  args: { orderRef: v.string(), idempotencyKey: v.string() },
  handler: async (ctx, args): Promise<{ kind: "adopted" | "existing"; attempt: CheckoutAttemptView } | { kind: "exception" }> => {
    const order = await findCheckoutOrderForPayment(ctx, args);
    const existing = await findAttemptForOrder(ctx, order.orderRef);
    if (existing) return { kind: "existing", attempt: attemptView(existing) };
    const now = Date.now();
    const created = await legacySessionCreation(ctx, order.orderRef);
    if (order.status !== "payment_pending" || !created) {
      await openOperationsException(ctx, {
        category: "checkout_attempt",
        code: "legacy_payment_pending_without_session",
        dedupeKey: `checkout_attempt:legacy_payment_pending_without_session:${order.orderRef}`,
        moneyReceived: false,
        orderRef: order.orderRef,
        amountCents: order.totalCents,
        currency: order.currency,
        evidence: { orderStatus: order.status },
        now
      });
      return { kind: "exception" };
    }
    const raw = created.raw && typeof created.raw === "object" ? (created.raw as { url?: unknown; livemode?: unknown }) : {};
    // Pre-attempt Sessions used Stripe's default 24-hour expiry.
    const expiresAt = created.createdAt + 24 * 60 * 60 * 1000;
    const reconcileAt = Math.max(now, Math.min(expiresAt + checkoutExpiryReconcileMarginMs, now + 60_000));
    const attemptId = await ctx.db.insert("checkoutPaymentAttempts", {
      orderRef: order.orderRef,
      attemptNonce: `legacy${created._id.replace(/[^a-z0-9]/gi, "").toLowerCase()}`.slice(0, 64),
      stripeMode: created.providerPaymentId.startsWith("cs_live_") ? "live" : "test",
      apiVersion: "legacy",
      endpoint: "/checkout/sessions",
      providerIdempotencyKey: created.idempotencyKey ?? `legacy:${order.orderRef}`,
      requestParams: [],
      amountCents: created.amountCents,
      currency: created.currency,
      expiresAt,
      termsVersion: "legacy",
      liabilityWaiverVersion: "legacy",
      status: "open",
      providerSessionId: created.providerPaymentId,
      providerSessionUrl: typeof raw.url === "string" ? raw.url : undefined,
      providerRequestCount: 1,
      version: 1,
      reconcileAt,
      reconcileCount: 0,
      legacy: true,
      createdAt: created.createdAt,
      updatedAt: now
    });
    await scheduleReconcile(ctx, attemptId, reconcileAt);
    return { kind: "adopted", attempt: attemptView((await ctx.db.get(attemptId))!) };
  }
});

/** Leases one due attempt for autonomous reconciliation. */
export const claimCheckoutAttemptReconciliation = internalMutation({
  args: { attemptId: v.id("checkoutPaymentAttempts"), leaseToken: v.string() },
  handler: async (ctx, args): Promise<
    { kind: "retrieve" | "replay"; attempt: CheckoutAttemptView } | null
  > => {
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) return null;
    const now = Date.now();
    if (attempt.reconcileAt === undefined || attempt.reconcileAt > now) return null;
    if (attempt.leaseExpiresAt !== undefined && attempt.leaseExpiresAt > now) return null;
    if (attempt.status === "open" && attempt.providerSessionId) {
      await patchCheckoutAttempt(ctx, attempt, {
        leaseToken: args.leaseToken,
        leaseExpiresAt: now + checkoutAttemptLeaseMs,
        reconcileCount: attempt.reconcileCount + 1,
        lastReconciledAt: now
      }, now);
      return { kind: "retrieve", attempt: attemptView((await ctx.db.get(args.attemptId))!) };
    }
    if (attempt.status === "creating" || attempt.status === "creation_unknown") {
      const claim = await claimReplay(ctx, attempt, args.leaseToken, now);
      if (claim !== "claimed") return null;
      return { kind: "replay", attempt: attemptView((await ctx.db.get(args.attemptId))!) };
    }
    await patchCheckoutAttempt(ctx, attempt, { reconcileAt: undefined }, now);
    return null;
  }
});

const reconciliationResult = v.union(
  v.object({
    state: v.literal("paid"),
    providerPaymentIntentId: v.string(),
    attemptNonce: v.optional(v.string()),
    livemode: v.boolean(),
    ticketCode: v.string(),
    raw: sanitizedSession
  }),
  v.object({ state: v.literal("expired"), attemptNonce: v.optional(v.string()), raw: sanitizedSession }),
  v.object({ state: v.literal("open") }),
  v.object({ state: v.literal("complete_unpaid") }),
  v.object({ state: v.literal("unknown"), reason: v.string() }),
  v.object({ state: v.literal("config_missing"), reason: v.string() }),
  v.object({ state: v.literal("mismatch"), reason: v.string() }),
  v.object({ state: v.literal("created"), providerSessionId: v.string(), url: v.string(), raw: sanitizedSession }),
  v.object({
    state: v.literal("create_failed"),
    kind: v.union(v.literal("unknown"), v.literal("rejected"), v.literal("conflict"), v.literal("mismatch")),
    reason: v.string()
  })
);

/**
 * Applies one worker's provider read. A result from a worker whose lease or
 * version is no longer current is discarded, so overlapping workers and a
 * webhook that settled first can never apply a second effect.
 */
export const recordCheckoutReconciliationResult = internalMutation({
  args: {
    attemptId: v.id("checkoutPaymentAttempts"),
    leaseToken: v.string(),
    version: v.number(),
    result: reconciliationResult
  },
  handler: async (ctx, args): Promise<{ applied: boolean; status?: AttemptDoc["status"] }> => {
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt || attempt.leaseToken !== args.leaseToken || attempt.version !== args.version) {
      return { applied: false };
    }
    const now = Date.now();
    const result = args.result;
    const configDedupeKey = `checkout_attempt:checkout_reconciliation_unconfigured:${attempt.orderRef}:${attempt.attemptNonce}`;
    if (result.state !== "config_missing") {
      await resolveOperationsException(ctx, configDedupeKey, "configuration_restored", now);
    }

    switch (result.state) {
      case "created":
        return { applied: true, ...(await applyCreateOutcome(ctx, attempt, args.leaseToken, { kind: "created", ...result }, now)) };
      case "create_failed":
        return {
          applied: true,
          ...(await applyCreateOutcome(ctx, attempt, args.leaseToken, { kind: result.kind, reason: result.reason }, now))
        };
      case "paid": {
        const settled = await settleCheckoutPaid(ctx, {
          source: "reconciliation",
          eventType: "reconciliation.checkout_session.paid",
          providerSessionId: attempt.providerSessionId!,
          providerPaymentIntentId: result.providerPaymentIntentId,
          orderRef: attempt.orderRef,
          attemptNonce: attempt.legacy ? undefined : result.attemptNonce,
          amountCents: attempt.amountCents,
          currency: attempt.currency,
          sessionMode: "payment",
          livemode: result.livemode,
          sessionStatus: "complete",
          paymentStatus: "paid",
          // A provider read has no trusted payment time; the processing time
          // is later than the payment, so lateness can only become an exception.
          paidAt: undefined,
          ticketCode: result.ticketCode,
          raw: result.raw
        }, now);
        const after = await ctx.db.get(args.attemptId);
        if (after && after.leaseToken === args.leaseToken) {
          await patchCheckoutAttempt(ctx, after, { leaseToken: undefined, leaseExpiresAt: undefined, reconcileAt: undefined }, now);
        }
        return { applied: true, status: settled.kind === "fulfilled" ? "paid" : after?.status };
      }
      case "expired": {
        const settled = await settleCheckoutUnpaid(ctx, {
          source: "reconciliation",
          eventType: "reconciliation.checkout_session.expired",
          outcome: "canceled",
          providerSessionId: attempt.providerSessionId!,
          orderRef: attempt.orderRef,
          attemptNonce: attempt.legacy ? undefined : result.attemptNonce,
          sessionMode: "payment",
          livemode: attempt.stripeMode === "live",
          sessionStatus: "expired",
          paymentStatus: "unpaid",
          raw: result.raw
        }, now);
        if (settled.kind === "rejected") {
          const current = (await ctx.db.get(args.attemptId))!;
          await markAttemptException(ctx, current, "checkout_reconciliation_expiry_rejected", now, { reason: settled.reason });
          return { applied: true, status: "exception" };
        }
        return { applied: true, status: "expired" };
      }
      case "mismatch":
        await markAttemptException(ctx, attempt, "checkout_session_provider_mismatch", now, { reason: result.reason });
        return { applied: true, status: "exception" };
      case "open":
      case "complete_unpaid":
      case "unknown": {
        if (attempt.reconcileCount >= checkoutReconcileMaxAttempts) {
          await markAttemptException(ctx, attempt, `checkout_reconciliation_exhausted_${result.state}`, now, {
            reason: "reason" in result ? result.reason : undefined
          });
          return { applied: true, status: "exception" };
        }
        // An open Session is checked again just after its frozen expiry; it
        // is never expired early by automation.
        // reconcileCount already includes this claim.
        const reconcileAt =
          result.state === "open" && now < attempt.expiresAt
            ? attempt.expiresAt + checkoutExpiryReconcileMarginMs
            : now + reconcileBackoffMs(attempt.reconcileCount - 1);
        await patchCheckoutAttempt(ctx, attempt, {
          leaseToken: undefined,
          leaseExpiresAt: undefined,
          lastProviderState: result.state,
          lastError: "reason" in result ? result.reason : undefined,
          reconcileAt
        }, now);
        await scheduleReconcile(ctx, attempt._id, reconcileAt);
        return { applied: true, status: attempt.status };
      }
      case "config_missing": {
        await openOperationsException(ctx, {
          category: "checkout_attempt",
          code: "checkout_reconciliation_unconfigured",
          dedupeKey: configDedupeKey,
          moneyReceived: false,
          orderRef: attempt.orderRef,
          providerSessionId: attempt.providerSessionId,
          amountCents: attempt.amountCents,
          currency: attempt.currency,
          evidence: { reason: result.reason },
          now
        });
        if (attempt.reconcileCount >= checkoutConfigMaxAttempts) {
          await markAttemptException(ctx, attempt, "checkout_reconciliation_exhausted_config_missing", now, {
            reason: result.reason
          });
          return { applied: true, status: "exception" };
        }
        const reconcileAt = now + configBackoffMs(attempt.reconcileCount - 1);
        await patchCheckoutAttempt(ctx, attempt, {
          leaseToken: undefined,
          leaseExpiresAt: undefined,
          lastError: result.reason,
          lastProviderState: "config_missing",
          reconcileAt
        }, now);
        await scheduleReconcile(ctx, attempt._id, reconcileAt);
        return { applied: true, status: attempt.status };
      }
    }
  }
});

/**
 * Autonomous reconciliation of one known attempt. Reads (or, inside the safe
 * replay window, replays the exact frozen create) and records the classified
 * provider state. Never expires a live Session and never guesses a release.
 */
export const reconcileCheckoutAttempt = internalAction({
  args: { attemptId: v.id("checkoutPaymentAttempts") },
  handler: async (ctx, args): Promise<null> => {
    const leaseToken = crypto.randomUUID();
    const claim = await ctx.runMutation(makeFunctionReference<
      "mutation",
      { attemptId: AttemptId; leaseToken: string },
      { kind: "retrieve" | "replay"; attempt: CheckoutAttemptView } | null
    >("checkoutReconciliation:claimCheckoutAttemptReconciliation"), { attemptId: args.attemptId, leaseToken });
    if (!claim) return null;
    const attempt = claim.attempt;
    const record = (result: Record<string, unknown>) =>
      ctx.runMutation(recordReconciliationResultMutation, {
        attemptId: args.attemptId,
        leaseToken,
        version: attempt.version,
        result
      });

    let secretKey: string;
    try {
      const configured = configuredStripeSecret();
      if (configured.mode !== attempt.stripeMode) {
        throw new Error("SKYLA_STRIPE_MODE does not match the stored checkout attempt");
      }
      secretKey = configured.secretKey;
    } catch (error) {
      await record({ state: "config_missing", reason: errorReason(error) });
      return null;
    }

    if (claim.kind === "replay") {
      await record(await replayFrozenCreate(attempt, secretKey));
      return null;
    }

    let response;
    try {
      response = await stripeRequest(`/checkout/sessions/${encodeURIComponent(attempt.providerSessionId!)}`, {
        method: "GET",
        secretKey,
        apiVersion: attempt.legacy ? stripeApiVersion : attempt.apiVersion
      });
    } catch {
      await record({ state: "unknown", reason: "network_error" });
      return null;
    }
    if (!response.ok) {
      await record(
        response.status === 401 || response.status === 403
          ? { state: "config_missing", reason: `stripe_http_${response.status}` }
          : response.status === 404
            ? { state: "mismatch", reason: "session_not_found_for_configured_account" }
            : { state: "unknown", reason: `stripe_http_${response.status}` }
      );
      return null;
    }
    const session = response.body as StripeCheckoutSessionResponse;
    const classified = classifyRetrievedCheckoutSession(session, attemptExpectation(attempt, false));
    const nonce = session?.metadata?.attempt_nonce;
    switch (classified.state) {
      case "paid":
        await record({
          state: "paid",
          providerPaymentIntentId: classified.providerPaymentIntentId,
          ...(nonce ? { attemptNonce: nonce } : {}),
          livemode: session.livemode === true,
          ticketCode: newTicketCode(),
          raw: sanitizeStripeCheckoutSession(session)
        });
        break;
      case "expired":
        await record({ state: "expired", ...(nonce ? { attemptNonce: nonce } : {}), raw: sanitizeStripeCheckoutSession(session) });
        break;
      case "mismatch":
      case "unknown":
        await record({ state: classified.state, reason: classified.reason });
        break;
      default:
        await record({ state: classified.state });
    }
    return null;
  }
});

const recordReconciliationResultMutation = makeFunctionReference<
  "mutation",
  { attemptId: AttemptId; leaseToken: string; version: number; result: Record<string, unknown> },
  { applied: boolean; status?: AttemptDoc["status"] }
>("checkoutReconciliation:recordCheckoutReconciliationResult");

/** Sends the exact stored request with its stored key and classifies it. */
export async function replayFrozenCreate(attempt: CheckoutAttemptView, secretKey: string) {
  if (!attempt.providerConfigurationFingerprint ||
      attempt.providerConfigurationFingerprint !== await providerConfigurationFingerprint(["stripe", secretKey])) {
    return { state: "create_failed" as const, kind: "mismatch" as const, reason: "provider_configuration_changed" };
  }
  let response;
  try {
    response = await stripeRequest(attempt.endpoint, {
      method: "POST",
      secretKey,
      apiVersion: attempt.apiVersion,
      idempotencyKey: attempt.providerIdempotencyKey,
      body: new URLSearchParams(attempt.requestParams.map((param) => [param.name, param.value]))
    });
  } catch {
    return { state: "create_failed" as const, kind: "unknown" as const, reason: "network_error" };
  }
  if (!response.ok) {
    const failure = classifyStripeCreateFailure(response.status, response.body);
    return { state: "create_failed" as const, kind: failure.kind, reason: failure.reason };
  }
  const session = response.body as StripeCheckoutSessionResponse;
  const verification = verifyCreatedCheckoutSession(session, attemptExpectation(attempt, true));
  if (!verification.ok) {
    return { state: "create_failed" as const, kind: "mismatch" as const, reason: verification.reason };
  }
  return {
    state: "created" as const,
    providerSessionId: verification.sessionId,
    url: verification.url,
    raw: sanitizeStripeCheckoutSession(session)
  };
}

/**
 * Bounded cron sweep for attempts whose scheduled reconciliation was lost
 * (scheduled actions run at most once). Leases make duplicates harmless.
 */
export const sweepCheckoutAttempts = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const now = Date.now();
    const due = await ctx.db
      .query("checkoutPaymentAttempts")
      .withIndex("by_reconcileAt", (q) => q.gte("reconcileAt", 0).lte("reconcileAt", now))
      .take(25);
    let scheduled = 0;
    for (const attempt of due) {
      if (attempt.leaseExpiresAt !== undefined && attempt.leaseExpiresAt > now) continue;
      await ctx.scheduler.runAfter(0, reconcileCheckoutAttemptAction, { attemptId: attempt._id });
      scheduled += 1;
    }
    return { scheduled };
  }
});

function errorReason(error: unknown) {
  const message = error instanceof Error ? error.message : "configuration_error";
  return message.slice(0, 160);
}
