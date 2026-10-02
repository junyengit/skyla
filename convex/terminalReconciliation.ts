import { assertBookableVisitSlot } from "@skyla/payments";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx
} from "./_generated/server";
import { requireStaffUser } from "./lib/auth";
import { findCapacityReservation, loadVenueHours, releaseUnpaidCapacityHold } from "./lib/capacity";
import { checkoutDraftPaymentStartBufferMs } from "./lib/checkoutDraftExpiry";
import { configBackoffMs, reconcileBackoffMs } from "./lib/checkoutAttempts";
import { openOperationsException, resolveOperationsException } from "./lib/operationsExceptions";
import { assertStoredPaymentLineProvenance, normalizeIdempotencyKey } from "./lib/orderDraftPersistence";
import { posTicketPartySize } from "./lib/posFulfillment";
import { ensureIntentLedgerRow, patchTerminalAttempt, settlePosCanceled, settlePosPaid } from "./lib/posSettlement";
import { providerConfigurationFingerprint } from "./lib/providerIdentity";
import { configuredStripeSecret, stripeRequest } from "./lib/stripeHttp";
import {
  classifyRetrievedTerminalIntent,
  sanitizeStripeTerminalPaymentIntent,
  stripeApiVersion,
  stripeTerminalAttemptIdempotencyKey,
  stripeTerminalProcessIdempotencyKey,
  terminalIntentSource,
  verifyCreatedTerminalIntent,
  type StripeTerminalPaymentIntentResponse,
  type StripeTerminalSnapshot,
  type TerminalIntentExpectation
} from "./lib/stripeTerminal";
import {
  assertPosSaleOwner,
  classifyTerminalCreateFailure,
  terminalAttemptLeaseMs,
  terminalConfigMaxAttempts,
  terminalCreateMaxProviderRequests,
  terminalFirstReconcileDelayMs,
  terminalPaymentStateError,
  terminalReaderLeaseMs,
  terminalReaderMaxProcessAttempts,
  terminalReconcileMaxAttempts,
  terminalReplayWindowEndsAt
} from "./lib/terminalAttempts";
import { authorizeTerminalReaderSelection } from "./lib/terminalReaderRegistry";
import { newTicketCode } from "./lib/ticketDelivery";

declare const process: { env: Record<string, string | undefined> };

type AttemptDoc = Doc<"terminalPaymentAttempts">;
type AttemptId = Id<"terminalPaymentAttempts">;

/** What an action needs to replay, verify, retrieve or hand off one attempt. */
export type TerminalAttemptView = {
  attemptId: AttemptId;
  saleRef: string;
  attemptNonce: string;
  status: AttemptDoc["status"];
  stripeMode: AttemptDoc["stripeMode"];
  providerConfigurationFingerprint: string;
  apiVersion: string;
  endpoint: "/payment_intents";
  providerIdempotencyKey: string;
  requestParams: Array<{ name: string; value: string }>;
  amountCents: number;
  currency: "usd";
  readerId: string;
  providerPaymentIntentId?: string;
  createdAt: number;
  leaseExpiresAt?: number;
  version: number;
};

export function terminalAttemptView(attempt: AttemptDoc): TerminalAttemptView {
  return {
    attemptId: attempt._id,
    saleRef: attempt.saleRef,
    attemptNonce: attempt.attemptNonce,
    status: attempt.status,
    stripeMode: attempt.stripeMode,
    providerConfigurationFingerprint: attempt.providerConfigurationFingerprint,
    apiVersion: attempt.apiVersion,
    endpoint: attempt.endpoint,
    providerIdempotencyKey: attempt.providerIdempotencyKey,
    requestParams: attempt.requestParams,
    amountCents: attempt.amountCents,
    currency: attempt.currency,
    readerId: attempt.readerId,
    providerPaymentIntentId: attempt.providerPaymentIntentId,
    createdAt: attempt.createdAt,
    leaseExpiresAt: attempt.leaseExpiresAt,
    version: attempt.version
  };
}

export function terminalExpectation(attempt: TerminalAttemptView): TerminalIntentExpectation {
  return {
    saleRef: attempt.saleRef,
    amountCents: attempt.amountCents,
    currency: attempt.currency,
    stripeMode: attempt.stripeMode,
    attemptNonce: attempt.attemptNonce,
    providerPaymentIntentId: attempt.providerPaymentIntentId
  };
}

const reconcileTerminalAttemptAction = makeFunctionReference<"action", { attemptId: AttemptId }, null>(
  "terminalReconciliation:reconcileTerminalAttempt"
);

async function findAttemptForSale(ctx: QueryCtx | MutationCtx, saleRef: string) {
  return ctx.db
    .query("terminalPaymentAttempts")
    .withIndex("by_saleRef", (q) => q.eq("saleRef", saleRef))
    .first();
}

async function scheduleReconcile(ctx: MutationCtx, attemptId: AttemptId, reconcileAt: number) {
  await ctx.scheduler.runAt(reconcileAt, reconcileTerminalAttemptAction, { attemptId });
}

/** Moves an attempt to a visible exception; its capacity hold is kept. */
async function markAttemptException(
  ctx: MutationCtx,
  attempt: AttemptDoc,
  code: string,
  now: number,
  evidence: Record<string, string | number | boolean | undefined> = {}
) {
  await patchTerminalAttempt(ctx, attempt, {
    status: "exception",
    exceptionReason: code,
    reconcileAt: undefined,
    leaseToken: undefined,
    leaseExpiresAt: undefined
  }, now);
  await openOperationsException(ctx, {
    category: "terminal_attempt",
    code,
    dedupeKey: `terminal_attempt:${code}:${attempt.saleRef}:${attempt.attemptNonce}`,
    // Unknown: a payable intent may exist and may have been paid.
    moneyReceived: false,
    saleRef: attempt.saleRef,
    providerPaymentIntentId: attempt.providerPaymentIntentId,
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

async function findSaleForStaff(ctx: QueryCtx | MutationCtx, args: { saleRef: string; idempotencyKey: string }) {
  const staff = await requireStaffUser(ctx, ["admin", "pos"]);
  const idempotencyKey = normalizeIdempotencyKey(args.idempotencyKey);
  const sale = await ctx.db
    .query("posSales")
    .withIndex("by_saleRef", (q) => q.eq("saleRef", args.saleRef))
    .unique();
  if (!sale || sale.idempotencyKey !== idempotencyKey) {
    throw new Error("POS sale was not found for this payment attempt");
  }
  assertPosSaleOwner(staff, sale);
  return { staff, sale };
}

/**
 * Everything the start action needs before deciding to call Stripe: the
 * existing attempt, or, for an untouched draft, the checked snapshot. Every
 * gate (staff, reader registry, provenance, totals, draft expiry, visit slot)
 * runs here, before any write or network call.
 */
export const getTerminalPaymentContext = internalQuery({
  args: { saleRef: v.string(), idempotencyKey: v.string() },
  handler: async (ctx, args): Promise<
    | { kind: "attempt"; attempt: TerminalAttemptView }
    | { kind: "draft"; actorStaffUserId: Id<"staffUsers">; snapshot: StripeTerminalSnapshot & { readerId: string } }
  > => {
    const { staff, sale } = await findSaleForStaff(ctx, args);
    const attempt = await findAttemptForSale(ctx, sale.saleRef);
    if (attempt) return { kind: "attempt", attempt: terminalAttemptView(attempt) };
    if (sale.status === "paid") throw terminalPaymentStateError("payment_already_received");
    if (sale.status === "payment_pending") {
      // Started before frozen attempts; it is never given a second intent.
      throw terminalPaymentStateError("payment_needs_attention");
    }
    if (sale.status !== "draft") throw terminalPaymentStateError("payment_closed");
    const now = Date.now();
    if (sale.expiresAt !== undefined && sale.expiresAt <= now + checkoutDraftPaymentStartBufferMs) {
      throw terminalPaymentStateError("sale_not_ready");
    }
    if (!sale.readerId) throw new Error("POS sale does not have a stored Terminal reader");
    const reader = authorizeTerminalReaderSelection(
      { readerId: sale.readerId, terminalLocationId: sale.terminalLocationId },
      process.env.SKYLA_TERMINAL_READER_REGISTRY
    );
    const lines = await ctx.db
      .query("posSaleLines")
      .withIndex("by_saleRef", (q) => q.eq("saleRef", sale.saleRef))
      .take(101);
    if (lines.length > 100) throw new Error("POS sale has too many stored lines");
    assertStoredPaymentLineProvenance(lines, "POS Terminal");
    const partySize = posTicketPartySize(lines);
    if (partySize > 0) {
      if (!sale.visitDate || !sale.entryTime) throw terminalPaymentStateError("sale_not_ready");
      assertBookableVisitSlot(await loadVenueHours(ctx), sale.visitDate, sale.entryTime, now);
      const hold = await findCapacityReservation(ctx, { saleRef: sale.saleRef });
      if (!hold || hold.status !== "draft" || hold.partySize !== partySize) throw terminalPaymentStateError("sale_not_ready");
    }
    return {
      kind: "draft",
      actorStaffUserId: staff._id,
      snapshot: {
        saleRef: sale.saleRef,
        currency: sale.currency,
        subtotalCents: sale.subtotalCents,
        feeCents: sale.feeCents,
        totalCents: sale.totalCents,
        customerEmailLower: sale.customerEmailLower,
        readerId: reader.readerId!,
        terminalLocationId: reader.terminalLocationId,
        ...(partySize > 0 ? { visitDate: sale.visitDate, entryTime: sale.entryTime, partySize } : {}),
        lines: lines.map((line) => ({
          name: line.name,
          quantity: line.quantity,
          unitAmountCents: line.unitAmountCents,
          lineTotalCents: line.lineTotalCents
        }))
      }
    };
  }
});

const frozenTerminalRequest = v.object({
  apiVersion: v.string(),
  providerIdempotencyKey: v.string(),
  requestParams: v.array(v.object({ name: v.string(), value: v.string() })),
  amountCents: v.number(),
  currency: v.literal("usd"),
  readerId: v.string(),
  terminalLocationId: v.optional(v.string())
});

/**
 * Freezes the exact PaymentIntent request and moves the sale and its hold to
 * payment_pending in one transaction, before any network call. Concurrent
 * starts for the same sale get the one existing attempt back.
 */
export const openTerminalPaymentAttempt = internalMutation({
  args: {
    saleRef: v.string(),
    idempotencyKey: v.string(),
    attemptNonce: v.string(),
    leaseToken: v.string(),
    stripeMode: v.union(v.literal("test"), v.literal("live")),
    providerConfigurationFingerprint: v.string(),
    request: frozenTerminalRequest
  },
  handler: async (ctx, args): Promise<{ kind: "opened" | "existing"; attempt: TerminalAttemptView }> => {
    const { staff, sale } = await findSaleForStaff(ctx, args);
    const existing = await findAttemptForSale(ctx, sale.saleRef);
    if (existing) return { kind: "existing", attempt: terminalAttemptView(existing) };
    if (sale.status === "payment_pending") throw terminalPaymentStateError("payment_needs_attention");
    if (sale.status !== "draft") throw terminalPaymentStateError("payment_closed");
    const now = Date.now();
    if (sale.expiresAt !== undefined && sale.expiresAt <= now + checkoutDraftPaymentStartBufferMs) {
      throw terminalPaymentStateError("sale_not_ready");
    }
    if (!/^[a-f0-9]{64}$/.test(args.providerConfigurationFingerprint)) {
      throw new Error("Terminal provider configuration identity is invalid");
    }
    const { request } = args;
    const param = (name: string) => request.requestParams.find((entry) => entry.name === name)?.value;
    if (
      request.apiVersion !== stripeApiVersion ||
      request.amountCents !== sale.totalCents ||
      request.currency !== sale.currency ||
      request.readerId !== sale.readerId ||
      request.providerIdempotencyKey !== stripeTerminalAttemptIdempotencyKey(sale.saleRef, args.attemptNonce) ||
      param("amount") !== String(sale.totalCents) ||
      param("currency") !== sale.currency ||
      param("capture_method") !== "automatic" ||
      param("metadata[sale_ref]") !== sale.saleRef ||
      param("metadata[source]") !== terminalIntentSource ||
      param("metadata[attempt_nonce]") !== args.attemptNonce ||
      new Set(request.requestParams.map((entry) => entry.name)).size !== request.requestParams.length
    ) {
      throw new Error("Terminal attempt request does not match the stored POS sale");
    }

    const lines = await ctx.db
      .query("posSaleLines")
      .withIndex("by_saleRef", (q) => q.eq("saleRef", sale.saleRef))
      .take(101);
    const partySize = posTicketPartySize(lines);
    if (partySize > 0) {
      // TTL and draft release can no longer touch these places.
      const hold = await findCapacityReservation(ctx, { saleRef: sale.saleRef });
      if (!hold || hold.status !== "draft" || hold.partySize !== partySize || !sale.visitDate || !sale.entryTime) {
        throw terminalPaymentStateError("sale_not_ready");
      }
      assertBookableVisitSlot(await loadVenueHours(ctx), sale.visitDate, sale.entryTime, now);
      await ctx.db.patch(hold._id, { status: "payment_pending", paymentPendingAt: now, updatedAt: now });
    }
    await ctx.db.patch(sale._id, { status: "payment_pending", updatedAt: now });

    const reconcileAt = now + terminalAttemptLeaseMs + 30_000;
    const attemptId = await ctx.db.insert("terminalPaymentAttempts", {
      saleRef: sale.saleRef,
      attemptNonce: args.attemptNonce,
      providerConfigurationFingerprint: args.providerConfigurationFingerprint,
      stripeMode: args.stripeMode,
      apiVersion: request.apiVersion,
      endpoint: "/payment_intents",
      providerIdempotencyKey: request.providerIdempotencyKey,
      requestParams: request.requestParams,
      amountCents: request.amountCents,
      currency: request.currency,
      readerId: request.readerId,
      ...(request.terminalLocationId ? { terminalLocationId: request.terminalLocationId } : {}),
      startedBy: staff._id,
      status: "creating",
      providerRequestCount: 1,
      firstProviderRequestAt: now,
      lastProviderRequestAt: now,
      leaseToken: args.leaseToken,
      leaseExpiresAt: now + terminalAttemptLeaseMs,
      version: 1,
      // Safety net: if the action dies mid-request, reconciliation replays it.
      reconcileAt,
      reconcileCount: 0,
      readerProcessCount: 0,
      createdAt: now,
      updatedAt: now
    });
    await scheduleReconcile(ctx, attemptId, reconcileAt);
    await ctx.db.insert("auditEvents", {
      actorStaffUserId: staff._id,
      action: "pos.terminalAttempt.open",
      entityType: "posSale",
      entityRef: sale.saleRef,
      metadata: { amountCents: request.amountCents, readerId: request.readerId, partySize },
      createdAt: now
    });
    return { kind: "opened", attempt: terminalAttemptView((await ctx.db.get(attemptId))!) };
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
  if (now >= terminalReplayWindowEndsAt(attempt) || attempt.providerRequestCount >= terminalCreateMaxProviderRequests) {
    // A later replay could outlive the key's retention; staff must reconcile.
    await markAttemptException(ctx, attempt, "terminal_intent_creation_outcome_unknown", now);
    return "window_closed";
  }
  await patchTerminalAttempt(ctx, attempt, {
    status: "creating",
    leaseToken,
    leaseExpiresAt: now + terminalAttemptLeaseMs,
    providerRequestCount: attempt.providerRequestCount + 1,
    lastProviderRequestAt: now,
    reconcileAt: now + terminalAttemptLeaseMs + 30_000
  }, now);
  return "claimed";
}

/** Leases an unknown-outcome attempt for a replay of its exact frozen request. */
export const claimTerminalAttemptForCreate = internalMutation({
  args: { attemptId: v.id("terminalPaymentAttempts"), leaseToken: v.string() },
  handler: async (ctx, args): Promise<
    | { kind: "claimed"; attempt: TerminalAttemptView }
    | { kind: "busy" | "window_closed" | "missing" }
    | { kind: "settled"; status: AttemptDoc["status"] }
  > => {
    await requireStaffUser(ctx, ["admin", "pos"]);
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) return { kind: "missing" };
    const claim = await claimReplay(ctx, attempt, args.leaseToken, Date.now());
    if (claim === "claimed") return { kind: "claimed", attempt: terminalAttemptView((await ctx.db.get(args.attemptId))!) };
    if (claim === "settled") return { kind: "settled", status: attempt.status };
    return { kind: claim };
  }
});

type CreateOutcome =
  | { kind: "created"; providerPaymentIntentId: string; raw?: unknown }
  | { kind: "unknown" | "rejected" | "conflict" | "mismatch"; reason: string };

async function applyCreateOutcome(ctx: MutationCtx, attempt: AttemptDoc, leaseToken: string, outcome: CreateOutcome, now: number) {
  const holdsLease = attempt.leaseToken === leaseToken;
  if (outcome.kind === "created") {
    if (attempt.providerPaymentIntentId && attempt.providerPaymentIntentId !== outcome.providerPaymentIntentId) {
      await markAttemptException(ctx, attempt, "terminal_attempt_two_intents", now, {
        returnedIntentId: outcome.providerPaymentIntentId
      });
      return { status: "exception" as const };
    }
    const stillCreating = attempt.status === "creating" || attempt.status === "creation_unknown";
    const reconcileAt = now + terminalFirstReconcileDelayMs;
    await patchTerminalAttempt(ctx, attempt, {
      providerPaymentIntentId: outcome.providerPaymentIntentId,
      ...(stillCreating ? { status: "open" as const, reconcileAt, lastError: undefined, lastProviderState: "requires_payment_method" } : {}),
      ...(holdsLease ? { leaseToken: undefined, leaseExpiresAt: undefined } : {})
    }, now);
    // The known intent id is stored before the action returns to the cashier.
    await ensureIntentLedgerRow(ctx, attempt, outcome.providerPaymentIntentId, now, outcome.raw);
    if (stillCreating) {
      await scheduleReconcile(ctx, attempt._id, reconcileAt);
      await ctx.db.insert("auditEvents", {
        action: "pos.terminalIntent.create",
        entityType: "posSale",
        entityRef: attempt.saleRef,
        metadata: { amountCents: attempt.amountCents, providerPaymentId: outcome.providerPaymentIntentId },
        createdAt: now
      });
    }
    return { status: stillCreating ? ("open" as const) : attempt.status };
  }

  if (!holdsLease || (attempt.status !== "creating" && attempt.status !== "creation_unknown")) {
    return { status: attempt.status, stale: true };
  }

  if (outcome.kind === "unknown") {
    const windowEnd = terminalReplayWindowEndsAt(attempt);
    if (now >= windowEnd || attempt.providerRequestCount >= terminalCreateMaxProviderRequests) {
      await markAttemptException(ctx, { ...attempt, lastError: outcome.reason }, "terminal_intent_creation_outcome_unknown", now);
      return { status: "exception" as const };
    }
    const reconcileAt = Math.min(now + reconcileBackoffMs(attempt.providerRequestCount - 1), windowEnd - 1000);
    await patchTerminalAttempt(ctx, attempt, {
      status: "creation_unknown",
      lastError: outcome.reason,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      reconcileAt
    }, now);
    await scheduleReconcile(ctx, attempt._id, reconcileAt);
    return { status: "creation_unknown" as const };
  }

  if (
    outcome.kind === "rejected" &&
    attempt.providerRequestCount === 1 &&
    attempt.status === "creating" &&
    !attempt.providerPaymentIntentId &&
    attempt.lastError === undefined
  ) {
    // The only request ever sent with this key was refused by Stripe before
    // execution, so no intent exists and the unpaid hold can be released. A
    // refusal of a replay never disproves an earlier unknown create.
    await patchTerminalAttempt(ctx, attempt, {
      status: "rejected",
      lastError: outcome.reason,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      reconcileAt: undefined,
      settledAt: now
    }, now);
    const sale = await ctx.db
      .query("posSales")
      .withIndex("by_saleRef", (q) => q.eq("saleRef", attempt.saleRef))
      .unique();
    if (sale?.status === "payment_pending") {
      await ctx.db.patch(sale._id, { status: "canceled", updatedAt: now });
      await releaseUnpaidCapacityHold(ctx, { saleRef: attempt.saleRef }, "stripe_terminal_creation_rejected", now);
    }
    await openOperationsException(ctx, {
      category: "terminal_attempt",
      code: "terminal_intent_creation_rejected",
      dedupeKey: `terminal_attempt:terminal_intent_creation_rejected:${attempt.saleRef}:${attempt.attemptNonce}`,
      moneyReceived: false,
      saleRef: attempt.saleRef,
      amountCents: attempt.amountCents,
      currency: attempt.currency,
      evidence: { reason: outcome.reason },
      now
    });
    return { status: "rejected" as const };
  }

  await markAttemptException(ctx, { ...attempt, lastError: outcome.reason }, `terminal_intent_creation_${outcome.kind}`, now, {
    reason: outcome.reason
  });
  return { status: "exception" as const };
}

export const recordTerminalCreateOutcome = internalMutation({
  args: {
    attemptId: v.id("terminalPaymentAttempts"),
    leaseToken: v.string(),
    outcome: v.union(
      v.object({ kind: v.literal("created"), providerPaymentIntentId: v.string(), raw: v.optional(v.any()) }),
      v.object({
        kind: v.union(v.literal("unknown"), v.literal("rejected"), v.literal("conflict"), v.literal("mismatch")),
        reason: v.string()
      })
    )
  },
  handler: async (ctx, args): Promise<{ status: AttemptDoc["status"]; stale?: boolean }> => {
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) throw new Error("Terminal attempt was not found");
    return applyCreateOutcome(ctx, attempt, args.leaseToken, args.outcome as CreateOutcome, Date.now());
  }
});

type ReconcileClaim = { kind: "retrieve" | "replay"; attempt: TerminalAttemptView } | null;

/** Leases one due attempt for autonomous reconciliation. */
export const claimTerminalAttemptReconciliation = internalMutation({
  args: { attemptId: v.id("terminalPaymentAttempts"), leaseToken: v.string() },
  handler: async (ctx, args): Promise<ReconcileClaim> => {
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) return null;
    const now = Date.now();
    if (attempt.reconcileAt === undefined || attempt.reconcileAt > now) return null;
    return claimForProviderWork(ctx, attempt, args.leaseToken, now, true);
  }
});

/**
 * A staff Refresh Status: one bounded, leased, authoritative provider read
 * (or exact replay inside the safe window). Never creates a new intent.
 */
export const claimTerminalRefresh = internalMutation({
  args: { saleRef: v.string(), leaseToken: v.string() },
  handler: async (ctx, args): Promise<ReconcileClaim | { kind: "none" | "busy" }> => {
    const staff = await requireStaffUser(ctx, ["admin", "pos"]);
    // Ownership is checked before any lease or provider work is reserved.
    const sale = await ctx.db
      .query("posSales")
      .withIndex("by_saleRef", (q) => q.eq("saleRef", args.saleRef))
      .unique();
    if (!sale) throw new Error("POS sale was not found");
    assertPosSaleOwner(staff, sale);
    const attempt = await findAttemptForSale(ctx, sale.saleRef);
    if (!attempt) return { kind: "none" };
    const now = Date.now();
    if (attempt.leaseExpiresAt !== undefined && attempt.leaseExpiresAt > now) return { kind: "busy" };
    // Bounded: at most one staff-triggered provider read every 5 seconds.
    if (attempt.lastReconciledAt !== undefined && now - attempt.lastReconciledAt < 5_000) return { kind: "busy" };
    return (await claimForProviderWork(ctx, attempt, args.leaseToken, now, false)) ?? { kind: "none" };
  }
});

async function claimForProviderWork(
  ctx: MutationCtx,
  attempt: AttemptDoc,
  leaseToken: string,
  now: number,
  scheduled: boolean
): Promise<ReconcileClaim> {
  if (attempt.leaseExpiresAt !== undefined && attempt.leaseExpiresAt > now) return null;
  const readable =
    attempt.providerPaymentIntentId &&
    (attempt.status === "open" || (!scheduled && attempt.status === "exception"));
  if (readable) {
    await patchTerminalAttempt(ctx, attempt, {
      leaseToken,
      leaseExpiresAt: now + terminalAttemptLeaseMs,
      reconcileCount: scheduled ? attempt.reconcileCount + 1 : attempt.reconcileCount,
      lastReconciledAt: now
    }, now);
    return { kind: "retrieve", attempt: terminalAttemptView((await ctx.db.get(attempt._id))!) };
  }
  if (attempt.status === "creating" || attempt.status === "creation_unknown") {
    const claim = await claimReplay(ctx, attempt, leaseToken, now);
    if (claim !== "claimed") return null;
    return { kind: "replay", attempt: terminalAttemptView((await ctx.db.get(attempt._id))!) };
  }
  if (scheduled && attempt.reconcileAt !== undefined) {
    await patchTerminalAttempt(ctx, attempt, { reconcileAt: undefined }, now);
  }
  return null;
}

const reconciliationResult = v.union(
  v.object({
    state: v.literal("paid"),
    providerPaymentIntentId: v.string(),
    attemptNonce: v.optional(v.string()),
    intentSource: v.optional(v.string()),
    livemode: v.boolean(),
    amountCents: v.number(),
    amountReceivedCents: v.number(),
    currency: v.literal("usd"),
    ticketCode: v.string(),
    raw: v.optional(v.any())
  }),
  v.object({
    state: v.literal("canceled"),
    providerPaymentIntentId: v.string(),
    attemptNonce: v.optional(v.string()),
    intentSource: v.optional(v.string()),
    livemode: v.boolean(),
    raw: v.optional(v.any())
  }),
  v.object({ state: v.literal("open"), providerState: v.string() }),
  v.object({ state: v.literal("unknown"), reason: v.string() }),
  v.object({ state: v.literal("config_missing"), reason: v.string() }),
  v.object({ state: v.literal("mismatch"), reason: v.string() }),
  v.object({ state: v.literal("created"), providerPaymentIntentId: v.string(), raw: v.optional(v.any()) }),
  v.object({
    state: v.literal("create_failed"),
    kind: v.union(v.literal("unknown"), v.literal("rejected"), v.literal("conflict"), v.literal("mismatch")),
    reason: v.string()
  })
);

export type TerminalReconciliationResult =
  | {
      state: "paid";
      providerPaymentIntentId: string;
      attemptNonce?: string;
      intentSource?: string;
      livemode: boolean;
      amountCents: number;
      amountReceivedCents: number;
      currency: "usd";
      ticketCode: string;
      raw?: unknown;
    }
  | { state: "canceled"; providerPaymentIntentId: string; attemptNonce?: string; intentSource?: string; livemode: boolean; raw?: unknown }
  | { state: "open"; providerState: string }
  | { state: "unknown" | "config_missing" | "mismatch"; reason: string }
  | { state: "created"; providerPaymentIntentId: string; raw?: unknown }
  | { state: "create_failed"; kind: "unknown" | "rejected" | "conflict" | "mismatch"; reason: string };

/**
 * Applies one worker's provider result. A result from a worker whose lease or
 * version is no longer current is discarded, so overlapping workers and a
 * webhook that settled first can never apply a second effect.
 */
export const recordTerminalReconciliationResult = internalMutation({
  args: {
    attemptId: v.id("terminalPaymentAttempts"),
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
    const result = args.result as TerminalReconciliationResult;
    const configDedupeKey = `terminal_attempt:terminal_reconciliation_unconfigured:${attempt.saleRef}:${attempt.attemptNonce}`;
    if (result.state !== "config_missing") {
      await resolveOperationsException(ctx, configDedupeKey, "configuration_restored", now);
    }
    const releaseLease = async () => {
      const after = await ctx.db.get(args.attemptId);
      if (after && after.leaseToken === args.leaseToken) {
        await patchTerminalAttempt(ctx, after, { leaseToken: undefined, leaseExpiresAt: undefined }, now);
      }
      return after;
    };

    switch (result.state) {
      case "created":
        return { applied: true, ...(await applyCreateOutcome(ctx, attempt, args.leaseToken, { kind: "created", ...result }, now)) };
      case "create_failed":
        return { applied: true, ...(await applyCreateOutcome(ctx, attempt, args.leaseToken, { kind: result.kind, reason: result.reason }, now)) };
      case "paid": {
        await settlePosPaid(ctx, {
          source: "reconciliation",
          eventType: "reconciliation.payment_intent.succeeded",
          providerPaymentIntentId: result.providerPaymentIntentId,
          saleRef: attempt.saleRef,
          attemptNonce: result.attemptNonce,
          intentSource: result.intentSource,
          amountCents: result.amountCents,
          amountReceivedCents: result.amountReceivedCents,
          currency: result.currency,
          livemode: result.livemode,
          intentStatus: "succeeded",
          // A provider read has no trusted payment time; the processing time
          // is later than the payment, so lateness can only become an exception.
          paidAt: undefined,
          ticketCode: result.ticketCode,
          raw: result.raw
        }, now);
        const after = await releaseLease();
        return { applied: true, status: after?.status };
      }
      case "canceled": {
        const settled = await settlePosCanceled(ctx, {
          source: "reconciliation",
          eventType: "reconciliation.payment_intent.canceled",
          providerPaymentIntentId: result.providerPaymentIntentId,
          saleRef: attempt.saleRef,
          attemptNonce: result.attemptNonce,
          intentSource: result.intentSource,
          amountCents: attempt.amountCents,
          currency: attempt.currency,
          livemode: result.livemode,
          intentStatus: "canceled",
          raw: result.raw
        }, now);
        if (settled.kind === "rejected") {
          const current = (await ctx.db.get(args.attemptId))!;
          await markAttemptException(ctx, current, "terminal_reconciliation_cancel_rejected", now, { reason: settled.reason });
          return { applied: true, status: "exception" };
        }
        return { applied: true, status: "canceled" };
      }
      case "mismatch":
        await markAttemptException(ctx, attempt, "terminal_intent_provider_mismatch", now, { reason: result.reason });
        return { applied: true, status: "exception" };
      case "open":
      case "unknown": {
        const lastProviderState = result.state === "open" ? result.providerState : "unknown";
        const lastError = result.state === "unknown" ? result.reason : undefined;
        if (attempt.status !== "open") {
          // A staff read of an exception attempt only records what it saw.
          await patchTerminalAttempt(ctx, attempt, { leaseToken: undefined, leaseExpiresAt: undefined, lastProviderState, lastError }, now);
          return { applied: true, status: attempt.status };
        }
        if (attempt.reconcileCount >= terminalReconcileMaxAttempts) {
          await markAttemptException(ctx, attempt, `terminal_reconciliation_exhausted_${result.state}`, now, { reason: lastError ?? lastProviderState });
          return { applied: true, status: "exception" };
        }
        // An unpaid open intent is never canceled by automation; it is read
        // again on a bounded backoff while staff can keep using it.
        const reconcileAt = now + reconcileBackoffMs(Math.max(0, attempt.reconcileCount - 1));
        await patchTerminalAttempt(ctx, attempt, {
          leaseToken: undefined,
          leaseExpiresAt: undefined,
          lastProviderState,
          lastError,
          reconcileAt
        }, now);
        await scheduleReconcile(ctx, attempt._id, reconcileAt);
        return { applied: true, status: attempt.status };
      }
      case "config_missing": {
        await openOperationsException(ctx, {
          category: "terminal_attempt",
          code: "terminal_reconciliation_unconfigured",
          dedupeKey: configDedupeKey,
          moneyReceived: false,
          saleRef: attempt.saleRef,
          providerPaymentIntentId: attempt.providerPaymentIntentId,
          amountCents: attempt.amountCents,
          currency: attempt.currency,
          evidence: { reason: result.reason },
          now
        });
        if (attempt.status !== "open" && attempt.status !== "creating" && attempt.status !== "creation_unknown") {
          await patchTerminalAttempt(ctx, attempt, { leaseToken: undefined, leaseExpiresAt: undefined, lastError: result.reason }, now);
          return { applied: true, status: attempt.status };
        }
        if (attempt.reconcileCount >= terminalConfigMaxAttempts) {
          await markAttemptException(ctx, attempt, "terminal_reconciliation_exhausted_config_missing", now, { reason: result.reason });
          return { applied: true, status: "exception" };
        }
        const reconcileAt = now + configBackoffMs(Math.max(0, attempt.reconcileCount - 1));
        await patchTerminalAttempt(ctx, attempt, {
          // A replay claim set status creating; without a request sent, keep
          // the outcome unknown rather than claiming creation is underway.
          ...(attempt.status === "creating" ? { status: "creation_unknown" as const } : {}),
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

const recordReconciliationResultMutation = makeFunctionReference<
  "mutation",
  { attemptId: AttemptId; leaseToken: string; version: number; result: TerminalReconciliationResult },
  { applied: boolean; status?: AttemptDoc["status"] }
>("terminalReconciliation:recordTerminalReconciliationResult");

/** The configured secret, checked against the attempt's frozen mode and merchant identity. */
export async function terminalProviderSecret(attempt: TerminalAttemptView): Promise<
  { ok: true; secretKey: string } | { ok: false; reason: string }
> {
  try {
    const configured = configuredStripeSecret();
    if (configured.mode !== attempt.stripeMode) {
      return { ok: false, reason: "SKYLA_STRIPE_MODE does not match the stored Terminal attempt" };
    }
    if (attempt.providerConfigurationFingerprint !== (await providerConfigurationFingerprint(["stripe", configured.secretKey]))) {
      // A changed key may belong to another merchant; never call it.
      return { ok: false, reason: "provider_configuration_changed" };
    }
    return { ok: true, secretKey: configured.secretKey };
  } catch (error) {
    return { ok: false, reason: (error instanceof Error ? error.message : "configuration_error").slice(0, 160) };
  }
}

/** Sends the exact stored request with its stored key and classifies it. */
export async function replayFrozenTerminalCreate(
  attempt: TerminalAttemptView,
  secretKey: string
): Promise<Extract<TerminalReconciliationResult, { state: "created" | "create_failed" }>> {
  if (attempt.providerConfigurationFingerprint !== (await providerConfigurationFingerprint(["stripe", secretKey]))) {
    return { state: "create_failed", kind: "mismatch", reason: "provider_configuration_changed" };
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
    return { state: "create_failed", kind: "unknown", reason: "network_error" };
  }
  if (!response.ok) {
    const failure = classifyTerminalCreateFailure(response.status, response.body);
    return { state: "create_failed", kind: failure.kind, reason: failure.reason };
  }
  const intent = response.body as StripeTerminalPaymentIntentResponse;
  const verification = verifyCreatedTerminalIntent(intent, terminalExpectation(attempt));
  if (!verification.ok) return { state: "create_failed", kind: "mismatch", reason: verification.reason };
  return { state: "created", providerPaymentIntentId: verification.paymentIntentId, raw: sanitizeStripeTerminalPaymentIntent(intent) };
}

/** One authoritative read of a known intent, classified against the frozen attempt. */
export async function retrieveTerminalIntent(
  attempt: TerminalAttemptView,
  secretKey: string
): Promise<TerminalReconciliationResult> {
  let response;
  try {
    response = await stripeRequest(`/payment_intents/${encodeURIComponent(attempt.providerPaymentIntentId!)}`, {
      method: "GET",
      secretKey,
      apiVersion: attempt.apiVersion
    });
  } catch {
    return { state: "unknown", reason: "network_error" };
  }
  if (!response.ok) {
    return response.status === 401 || response.status === 403
      ? { state: "config_missing", reason: `stripe_http_${response.status}` }
      : response.status === 404
        ? { state: "mismatch", reason: "intent_not_found_for_configured_account" }
        : { state: "unknown", reason: `stripe_http_${response.status}` };
  }
  const intent = response.body as StripeTerminalPaymentIntentResponse;
  const classified = classifyRetrievedTerminalIntent(intent, terminalExpectation(attempt));
  const metadata = intent.metadata ?? {};
  switch (classified.state) {
    case "paid":
      return {
        state: "paid",
        providerPaymentIntentId: classified.paymentIntentId,
        attemptNonce: metadata.attempt_nonce,
        intentSource: metadata.source,
        livemode: intent.livemode === true,
        amountCents: intent.amount!,
        amountReceivedCents: intent.amount_received!,
        currency: "usd",
        ticketCode: newTicketCode(),
        raw: sanitizeStripeTerminalPaymentIntent(intent)
      };
    case "canceled":
      return {
        state: "canceled",
        providerPaymentIntentId: classified.paymentIntentId,
        attemptNonce: metadata.attempt_nonce,
        intentSource: metadata.source,
        livemode: intent.livemode === true,
        raw: sanitizeStripeTerminalPaymentIntent(intent)
      };
    case "open":
      return { state: "open", providerState: classified.providerState };
    default:
      return { state: classified.state, reason: classified.reason };
  }
}

/** Runs one claimed provider operation and records it under the claim's lease. */
export async function runClaimedTerminalWork(
  ctx: ActionCtx,
  claim: { kind: "retrieve" | "replay"; attempt: TerminalAttemptView },
  leaseToken: string
) {
  const attempt = claim.attempt;
  const record = (result: TerminalReconciliationResult) =>
    ctx.runMutation(recordReconciliationResultMutation, {
      attemptId: attempt.attemptId,
      leaseToken,
      version: attempt.version,
      result
    });
  const secret = await terminalProviderSecret(attempt);
  if (!secret.ok) return record({ state: "config_missing", reason: secret.reason });
  if (claim.kind === "replay") return record(await replayFrozenTerminalCreate(attempt, secret.secretKey));
  return record(await retrieveTerminalIntent(attempt, secret.secretKey));
}

/**
 * Autonomous reconciliation of one known attempt: reads the intent (or,
 * inside the safe window, replays the exact frozen create) and records the
 * classified provider state. Never cancels an intent and never guesses a
 * release; missed webhooks are recovered here.
 */
export const reconcileTerminalAttempt = internalAction({
  args: { attemptId: v.id("terminalPaymentAttempts") },
  handler: async (ctx, args): Promise<null> => {
    const leaseToken = crypto.randomUUID();
    const claim = await ctx.runMutation(
      makeFunctionReference<"mutation", { attemptId: AttemptId; leaseToken: string }, ReconcileClaim>(
        "terminalReconciliation:claimTerminalAttemptReconciliation"
      ),
      { attemptId: args.attemptId, leaseToken }
    );
    if (!claim) return null;
    await runClaimedTerminalWork(ctx, claim, leaseToken);
    return null;
  }
});

/**
 * Bounded cron sweep for attempts whose scheduled reconciliation was lost
 * (scheduled actions run at most once). Leases make duplicates harmless.
 */
export const sweepTerminalAttempts = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const now = Date.now();
    const due = await ctx.db
      .query("terminalPaymentAttempts")
      .withIndex("by_reconcileAt", (q) => q.gte("reconcileAt", 0).lte("reconcileAt", now))
      .take(25);
    let scheduled = 0;
    for (const attempt of due) {
      if (attempt.leaseExpiresAt !== undefined && attempt.leaseExpiresAt > now) continue;
      await ctx.scheduler.runAfter(0, reconcileTerminalAttemptAction, { attemptId: attempt._id });
      scheduled += 1;
    }
    return { scheduled };
  }
});

/**
 * Reserves one reader handoff of the sale's one PaymentIntent. A decline or
 * reader failure is retried with the same intent and a new handoff key; a
 * new intent is never created for it.
 */
export const claimTerminalReaderProcess = internalMutation({
  args: { saleRef: v.string(), idempotencyKey: v.string() },
  handler: async (ctx, args): Promise<{
    attempt: TerminalAttemptView;
    processAttempt: number;
    processIdempotencyKey: string;
    actorStaffUserId: Id<"staffUsers">;
  }> => {
    const { staff, sale } = await findSaleForStaff(ctx, args);
    const attempt = await findAttemptForSale(ctx, sale.saleRef);
    if (!attempt) throw terminalPaymentStateError("sale_not_ready");
    if (attempt.status === "paid" || sale.status === "paid") throw terminalPaymentStateError("payment_already_received");
    if (attempt.status === "canceled" || attempt.status === "rejected") throw terminalPaymentStateError("payment_closed");
    if (attempt.status === "exception") throw terminalPaymentStateError("payment_needs_attention");
    if (attempt.status !== "open" || !attempt.providerPaymentIntentId) throw terminalPaymentStateError("payment_outcome_unknown");
    if (sale.status !== "payment_pending") throw terminalPaymentStateError("payment_needs_attention");
    if (sale.readerId !== attempt.readerId) throw new Error("Terminal reader does not match the stored POS sale");
    authorizeTerminalReaderSelection(
      { readerId: sale.readerId, terminalLocationId: sale.terminalLocationId },
      process.env.SKYLA_TERMINAL_READER_REGISTRY
    );
    const now = Date.now();
    if (attempt.readerProcessLeaseExpiresAt !== undefined && attempt.readerProcessLeaseExpiresAt > now) {
      throw terminalPaymentStateError("reader_busy");
    }
    if (attempt.readerProcessCount >= terminalReaderMaxProcessAttempts) {
      throw terminalPaymentStateError("payment_needs_attention");
    }
    const processAttempt = attempt.readerProcessCount + 1;
    const processIdempotencyKey = stripeTerminalProcessIdempotencyKey(
      sale.saleRef,
      attempt.providerPaymentIntentId,
      attempt.readerId,
      processAttempt
    );
    await ctx.db.patch(attempt._id, {
      readerProcessCount: processAttempt,
      readerProcessLeaseExpiresAt: now + terminalReaderLeaseMs,
      lastReaderProcessAt: now,
      updatedAt: now
    });
    return {
      attempt: terminalAttemptView({ ...attempt, readerProcessCount: processAttempt }),
      processAttempt,
      processIdempotencyKey,
      actorStaffUserId: staff._id
    };
  }
});

/** Records a reader handoff result. Reader acknowledgement is never payment. */
export const recordTerminalReaderProcess = internalMutation({
  args: {
    attemptId: v.id("terminalPaymentAttempts"),
    processAttempt: v.number(),
    actorStaffUserId: v.id("staffUsers"),
    outcome: v.union(
      v.object({ kind: v.literal("sent"), readerStatus: v.string(), actionStatus: v.string(), raw: v.optional(v.any()) }),
      v.object({ kind: v.literal("failed"), reason: v.string() }),
      v.object({ kind: v.literal("unknown"), reason: v.string() }),
      v.object({ kind: v.literal("skipped"), providerState: v.string() })
    )
  },
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) throw new Error("Terminal attempt was not found");
    const now = Date.now();
    const lastReaderStatus =
      args.outcome.kind === "sent"
        ? `${args.outcome.readerStatus}:${args.outcome.actionStatus}`
        : args.outcome.kind === "skipped"
          ? `skipped:${args.outcome.providerState}`
          : `${args.outcome.kind}:${args.outcome.reason}`.slice(0, 120);
    if (attempt.readerProcessCount === args.processAttempt) {
      await ctx.db.patch(attempt._id, { readerProcessLeaseExpiresAt: undefined, lastReaderStatus, updatedAt: now });
    }
    await ctx.db.insert("auditEvents", {
      actorStaffUserId: args.actorStaffUserId,
      action: "pos.terminalReader.process",
      entityType: "posSale",
      entityRef: attempt.saleRef,
      metadata: {
        providerPaymentId: attempt.providerPaymentIntentId ?? "unknown",
        readerId: attempt.readerId,
        processAttempt: args.processAttempt,
        result: lastReaderStatus
      },
      createdAt: now
    });
    return { lastReaderStatus };
  }
});
