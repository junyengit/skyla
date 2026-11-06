import { v } from "convex/values";
import {
  assertCurrentCheckoutLegalAcceptance,
  type CheckoutLegalAcceptanceInput
} from "@skyla/payments";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { assertCheckoutDraftCanStartPayment } from "./lib/checkoutDraftExpiry";
import { assertCheckoutFulfillmentReady } from "./lib/checkoutFulfillment";
import { settleCheckoutPaid, settleCheckoutUnpaid } from "./lib/checkoutSettlement";
import {
  hasOpenBillingExceptionForOrder,
  hasOpenBillingExceptionForSale,
  openOperationsException
} from "./lib/operationsExceptions";
import {
  recordPosPaymentFailed,
  settlePosCanceled,
  settlePosPaid,
  type TerminalIntentFacts
} from "./lib/posSettlement";
import type { StripeCheckoutSnapshot } from "./lib/stripeCheckout";
import type { StripeRefundStatus } from "./lib/stripeWebhook";
import { assertStoredPaymentLineProvenance } from "./lib/orderDraftPersistence";
import { assertTicketDeliveryReady, ensureTicketDelivery, sendTicketConfirmationAction } from "./lib/ticketDeliveryQueue";
import { assertCheckoutTimeAvailable } from "./lib/operatingHours";
import { loadVenueHours } from "./lib/capacity";
import {
  checkIntentOwnership,
  paidIdentityForIntent,
  paidIdentityForProviderPayment,
  paidSummaryForOrder,
  paidSummaryForSale
} from "./lib/paymentEvidence";

const finalRefundStatuses = new Set<StripeRefundStatus>(["failed", "canceled"]);
const refundCorrelationRetryWindowMs = 72 * 60 * 60 * 1000;
const refundFulfillmentInvalidatedAction = "payment.refund.fulfillmentInvalidated";
const refundFulfillmentRestoredAction = "payment.refund.fulfillmentRestored";

export function assertStoredCheckoutLegalAcceptance(
  acceptance: {
    orderRef: string;
    idempotencyKey: string;
    customerEmailLower?: string;
    termsVersion: string;
    termsAcceptanceText: string;
    liabilityWaiverVersion: string;
    liabilityWaiverAcceptanceText: string;
  } | null | undefined,
  expected: { orderRef: string; idempotencyKey: string; customerEmailLower?: string }
) {
  if (!acceptance) {
    throw new Error("Terms and liability waiver acceptance are required before payment");
  }
  if (
    acceptance.orderRef !== expected.orderRef ||
    acceptance.idempotencyKey !== expected.idempotencyKey ||
    acceptance.customerEmailLower !== expected.customerEmailLower
  ) {
    throw new Error("Checkout legal acceptance does not match the stored order");
  }
  const canonical = assertCurrentCheckoutLegalAcceptance({
    termsAccepted: true,
    termsVersion: acceptance.termsVersion,
    liabilityWaiverAccepted: true,
    liabilityWaiverVersion: acceptance.liabilityWaiverVersion
  });
  if (
    acceptance.termsAcceptanceText !== canonical.termsAcceptanceText ||
    acceptance.liabilityWaiverAcceptanceText !== canonical.liabilityWaiverAcceptanceText
  ) {
    throw new Error("Checkout legal acceptance language does not match the current documents");
  }
  return canonical;
}

export const recordCheckoutLegalAcceptance = internalMutation({
  args: {
    orderRef: v.string(),
    idempotencyKey: v.string(),
    legalAcceptance: v.object({
      termsAccepted: v.boolean(),
      termsVersion: v.string(),
      liabilityWaiverAccepted: v.boolean(),
      liabilityWaiverVersion: v.string()
    })
  },
  handler: async (ctx, args) => {
    const canonical = assertCurrentCheckoutLegalAcceptance(args.legalAcceptance as CheckoutLegalAcceptanceInput);
    const order = await ctx.db
      .query("orders")
      .withIndex("by_orderRef", (q) => q.eq("orderRef", args.orderRef))
      .unique();
    if (!order || order.channel !== "online" || order.idempotencyKey !== args.idempotencyKey) {
      throw new Error("Checkout order was not found for this legal acceptance");
    }
    assertCheckoutDraftCanStartPayment(order, Date.now());

    const existing = await ctx.db
      .query("checkoutLegalAcceptances")
      .withIndex("by_orderRef_idempotencyKey", (q) =>
        q.eq("orderRef", args.orderRef).eq("idempotencyKey", args.idempotencyKey)
      )
      .unique();
    if (existing) {
      assertStoredCheckoutLegalAcceptance(existing, {
        orderRef: order.orderRef,
        idempotencyKey: args.idempotencyKey,
        customerEmailLower: order.customerEmailLower
      });
      return { acceptanceId: existing._id, reused: true };
    }

    const acceptanceId = await ctx.db.insert("checkoutLegalAcceptances", {
      orderRef: order.orderRef,
      idempotencyKey: args.idempotencyKey,
      customerEmailLower: order.customerEmailLower,
      ...canonical,
      acceptedAt: Date.now(),
      source: "web-checkout"
    });
    return { acceptanceId, reused: false };
  }
});

export const getCheckoutPaymentSnapshot = internalQuery({
  args: {
    orderRef: v.string(),
    idempotencyKey: v.string()
  },
  handler: async (ctx, args): Promise<StripeCheckoutSnapshot> => {
    const order = await ctx.db
      .query("orders")
      .withIndex("by_orderRef", (q) => q.eq("orderRef", args.orderRef))
      .unique();
    if (!order || order.channel !== "online" || order.idempotencyKey !== args.idempotencyKey) {
      throw new Error("Checkout order was not found for this payment attempt");
    }
    assertCheckoutDraftCanStartPayment(order, Date.now());

    const [lines, hours, legalAcceptance] = await Promise.all([
      ctx.db
        .query("orderLineItems")
        .withIndex("by_orderRef", (q) => q.eq("orderRef", args.orderRef))
        .collect(),
      // Duplicated or malformed stored hours fail closed for a new payment.
      loadVenueHours(ctx),
      ctx.db
        .query("checkoutLegalAcceptances")
        .withIndex("by_orderRef_idempotencyKey", (q) =>
          q.eq("orderRef", args.orderRef).eq("idempotencyKey", args.idempotencyKey)
        )
        .unique()
    ]);
    assertStoredPaymentLineProvenance(lines, "Checkout");
    const fulfillment = assertCheckoutFulfillmentReady(order, lines);
    assertCheckoutTimeAvailable(
      hours,
      fulfillment.visitDate,
      fulfillment.entryTime
    );
    const canonicalAcceptance = assertStoredCheckoutLegalAcceptance(legalAcceptance, {
      orderRef: order.orderRef,
      idempotencyKey: args.idempotencyKey,
      customerEmailLower: order.customerEmailLower
    });

    return {
      orderRef: order.orderRef,
      currency: order.currency,
      subtotalCents: order.subtotalCents,
      feeCents: order.feeCents,
      totalCents: order.totalCents,
      customerEmailLower: order.customerEmailLower,
      visitDate: order.visitDate,
      entryTime: order.entryTime,
      termsVersion: canonicalAcceptance.termsVersion,
      liabilityWaiverVersion: canonicalAcceptance.liabilityWaiverVersion,
      lines: lines.map((line) => ({
        name: line.name,
        quantity: line.quantity,
        unitAmountCents: line.unitAmountCents,
        lineTotalCents: line.lineTotalCents
      }))
    };
  }
});

export const recordStripeTerminalWebhook = internalMutation({
  args: {
    providerEventId: v.string(),
    eventType: v.string(),
    outcome: v.union(v.literal("paid"), v.literal("failed"), v.literal("canceled"), v.literal("ignored")),
    providerPaymentId: v.optional(v.string()),
    saleRef: v.optional(v.string()),
    ticketCode: v.optional(v.string()),
    amountCents: v.optional(v.number()),
    amountReceivedCents: v.optional(v.number()),
    currency: v.optional(v.literal("usd")),
    // Signed PaymentIntent facts, verified against the frozen attempt.
    attemptNonce: v.optional(v.string()),
    intentSource: v.optional(v.string()),
    livemode: v.optional(v.boolean()),
    intentStatus: v.optional(v.string()),
    providerEventCreatedAt: v.optional(v.number()),
    raw: v.optional(v.any())
  },
  handler: async (ctx, args) => {
    const existingWebhook = await ctx.db
      .query("webhookEvents")
      .withIndex("by_provider_providerEventId", (q) =>
        q.eq("provider", "terminal").eq("providerEventId", args.providerEventId)
      )
      .first();
    if (existingWebhook) {
      await repairDuplicatePaidTerminalDelivery(ctx, args, existingWebhook);
      return {
        status: existingWebhook.status,
        duplicate: true,
        saleRef: existingWebhook.saleRef
      };
    }

    if (args.outcome === "ignored") {
      await insertWebhookEvent(ctx, {
        provider: "terminal",
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "ignored",
        saleRef: args.saleRef,
        raw: args.raw
      });
      return { status: "ignored", duplicate: false, saleRef: args.saleRef };
    }

    if (!args.providerPaymentId || !args.saleRef) {
      await insertWebhookEvent(ctx, {
        provider: "terminal",
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "failed",
        saleRef: args.saleRef,
        raw: { ...(args.raw ?? {}), reason: "missing_provider_payment_or_sale_ref" }
      });
      return { status: "failed", duplicate: false, saleRef: args.saleRef };
    }
    if (args.amountCents === undefined || !args.currency) {
      await insertWebhookEvent(ctx, {
        provider: "terminal",
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "failed",
        saleRef: args.saleRef,
        raw: { ...(args.raw ?? {}), reason: "missing_terminal_amount_or_currency" }
      });
      return { status: "failed", duplicate: false, saleRef: args.saleRef };
    }

    // Paid, declined and canceled outcomes share the correlation and money
    // checks used by staff Refresh and scheduled provider reads.
    const now = Date.now();
    const facts: TerminalIntentFacts = {
      source: "webhook",
      providerEventId: args.providerEventId,
      eventType: args.eventType,
      providerPaymentIntentId: args.providerPaymentId,
      saleRef: args.saleRef,
      attemptNonce: args.attemptNonce,
      intentSource: args.intentSource,
      amountCents: args.amountCents,
      amountReceivedCents: args.amountReceivedCents,
      currency: args.currency,
      livemode: args.livemode,
      intentStatus: args.intentStatus,
      paidAt: args.providerEventCreatedAt,
      ticketCode: args.ticketCode,
      raw: args.raw
    };
    let reason: string | undefined;
    if (args.outcome === "paid") {
      const result = await settlePosPaid(ctx, facts, now);
      if (result.kind !== "fulfilled") {
        reason = result.kind === "exception" ? result.code : result.reason;
      }
    } else {
      // A decline is not a cancellation: the same intent stays payable.
      const result =
        args.outcome === "failed" ? await recordPosPaymentFailed(ctx, facts, now) : await settlePosCanceled(ctx, facts, now);
      if (result.kind === "rejected") reason = result.reason;
    }
    if (reason) {
      // Paid evidence that cannot become a ticket is durably recorded as a
      // billing exception; the webhook itself is stored as not fulfilled.
      await insertWebhookEvent(ctx, {
        provider: "terminal",
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "failed",
        saleRef: args.saleRef,
        raw: { ...(args.raw ?? {}), reason }
      });
      return { status: "failed", duplicate: false, saleRef: args.saleRef };
    }
    await insertTerminalWebhookAuditEvent(ctx, {
      saleRef: args.saleRef,
      outcome: args.outcome,
      amountCents: args.amountCents,
      providerPaymentId: args.providerPaymentId,
      providerEventId: args.providerEventId,
      eventType: args.eventType,
      createdAt: now
    });
    await insertWebhookEvent(ctx, {
      provider: "terminal",
      providerEventId: args.providerEventId,
      eventType: args.eventType,
      status: "processed",
      saleRef: args.saleRef,
      raw: args.raw
    });
    return { status: "processed", duplicate: false, saleRef: args.saleRef };
  }
});

export const recordStripeRefundWebhook = internalMutation({
  args: {
    providerEventId: v.string(),
    eventType: v.string(),
    outcome: v.union(v.literal("refund"), v.literal("ignored")),
    providerRefundId: v.optional(v.string()),
    providerPaymentIntentId: v.optional(v.string()),
    refundStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("requires_action"),
        v.literal("succeeded"),
        v.literal("failed"),
        v.literal("canceled")
      )
    ),
    amountCents: v.optional(v.number()),
    currency: v.optional(v.literal("usd")),
    reason: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    providerEventCreatedAt: v.optional(v.number()),
    raw: v.optional(v.any())
  },
  handler: async (ctx, args) => {
    const existingWebhook = await ctx.db
      .query("webhookEvents")
      .withIndex("by_provider_providerEventId", (q) =>
        q.eq("provider", "stripe").eq("providerEventId", args.providerEventId)
      )
      .first();
    if (existingWebhook) {
      return {
        status: existingWebhook.status,
        duplicate: true,
        orderRef: existingWebhook.orderRef,
        saleRef: existingWebhook.saleRef
      };
    }

    if (args.outcome === "ignored") {
      await insertWebhookEvent(ctx, {
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "ignored",
        raw: args.raw
      });
      return { status: "ignored", duplicate: false };
    }

    if (
      !args.providerRefundId ||
      !args.providerPaymentIntentId ||
      !args.refundStatus ||
      args.amountCents === undefined ||
      !Number.isSafeInteger(args.amountCents) ||
      args.amountCents <= 0 ||
      !args.currency ||
      args.providerEventCreatedAt === undefined ||
      !Number.isSafeInteger(args.providerEventCreatedAt) ||
      args.providerEventCreatedAt < 0
    ) {
      await insertWebhookEvent(ctx, {
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "failed",
        raw: { ...(args.raw ?? {}), reason: "missing_refund_fields" }
      });
      return { status: "failed", duplicate: false };
    }

    // The intent's paid record, read with take(2): two paid rows leave the
    // refund's owner unproven, so no owner is chosen and nothing is changed;
    // the provider's refund facts stay durably visible for staff.
    const paidIdentity = await paidIdentityForIntent(ctx, args.providerPaymentIntentId);
    if (paidIdentity.kind === "duplicate") {
      return recordUnverifiedRefund(ctx, args, "refund_paid_identity_duplicate", {});
    }
    const paymentEvents = paidIdentity.kind === "one" ? [paidIdentity.row] : [];
    const paidEvents = paymentEvents.filter(
      (event) => event.status === "paid" && (event.provider === "stripe" || event.provider === "terminal")
    );
    const businessRefs = new Set(paidEvents.map((event) => event.orderRef ?? event.saleRef).filter(Boolean));
    const paymentProviders = new Set(paidEvents.map((event) => event.provider));
    const paidEvent = paidEvents[0];
    if (
      !paidEvent ||
      businessRefs.size !== 1 ||
      paymentProviders.size !== 1 ||
      paidEvents.some((event) => Boolean(event.orderRef) === Boolean(event.saleRef))
    ) {
      if (!paidEvent) {
        if (Date.now() - args.providerEventCreatedAt <= refundCorrelationRetryWindowMs) {
          return {
            status: "retryable",
            duplicate: false,
            reason: "paid_payment_intent_not_found"
          };
        }
        await insertWebhookEvent(ctx, {
          providerEventId: args.providerEventId,
          eventType: args.eventType,
          status: "failed",
          raw: { ...(args.raw ?? {}), reason: "paid_payment_intent_not_found_after_retry_window" }
        });
        return { status: "failed", duplicate: false };
      }
      await insertWebhookEvent(ctx, {
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "failed",
        raw: { ...(args.raw ?? {}), reason: "paid_payment_intent_not_found" }
      });
      return { status: "failed", duplicate: false };
    }
    if (paidEvents.some((event) => event.amountCents !== paidEvent.amountCents || event.currency !== paidEvent.currency)) {
      await insertWebhookEvent(ctx, {
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "failed",
        orderRef: paidEvent.orderRef,
        saleRef: paidEvent.saleRef,
        raw: { ...(args.raw ?? {}), reason: "paid_payment_ledger_conflict" }
      });
      return { status: "failed", duplicate: false, orderRef: paidEvent.orderRef, saleRef: paidEvent.saleRef };
    }
    const owner = { orderRef: paidEvent.orderRef, saleRef: paidEvent.saleRef };
    // A refund can change admission only when the original settled money is
    // still uniquely owned. Pending foreign claims and other paid purchases
    // cannot be hidden by choosing the one paid row of this intent.
    if (!paidEvent.providerPaymentId ||
        (paidEvent.provider === "terminal" && paidEvent.providerPaymentId !== args.providerPaymentIntentId)) {
      return recordUnverifiedRefund(ctx, args, "refund_payment_identity_unverified", owner);
    }
    const [providerIdentity, ownership, ownerPaid] = await Promise.all([
      paidIdentityForProviderPayment(ctx, paidEvent.provider, paidEvent.providerPaymentId),
      checkIntentOwnership(ctx, args.providerPaymentIntentId, (row) =>
        row.provider === paidEvent.provider &&
        row.orderRef === paidEvent.orderRef && row.saleRef === paidEvent.saleRef &&
        row.providerPaymentId === paidEvent.providerPaymentId
      ),
      paidEvent.orderRef
        ? paidSummaryForOrder(ctx, paidEvent.orderRef)
        : paidSummaryForSale(ctx, paidEvent.saleRef!)
    ]);
    if (
      providerIdentity.kind !== "one" || providerIdentity.row._id !== paidEvent._id ||
      ownership.kind !== "exclusive" || ownerPaid.overflow ||
      ownerPaid.rows.length !== 1 || ownerPaid.rows[0]._id !== paidEvent._id
    ) {
      return recordUnverifiedRefund(ctx, args, "refund_payment_identity_unverified", owner);
    }
    // Cancellation ownership comes from a bounded, action-indexed audit read;
    // an unprovable history never cancels, restores or releases anything.
    const invalidation = await findActiveRefundFulfillmentInvalidation(ctx, {
      entityType: paidEvent.orderRef ? "order" : "posSale",
      entityRef: (paidEvent.orderRef ?? paidEvent.saleRef) as string,
      providerPaymentIntentId: args.providerPaymentIntentId
    });
    if (invalidation.kind === "unverified") {
      return recordUnverifiedRefund(ctx, args, "refund_fulfillment_history_unverified", owner);
    }
    const activeInvalidation = invalidation.active;
    // Owner records are preflighted (take 2) before any write, so a duplicate
    // can neither throw after the refund is stored nor be chosen arbitrarily.
    const [entities, ownerBookings] = await Promise.all([
      paidEvent.orderRef
        ? ctx.db.query("orders").withIndex("by_orderRef", (q) => q.eq("orderRef", paidEvent.orderRef as string)).take(2)
        : ctx.db.query("posSales").withIndex("by_saleRef", (q) => q.eq("saleRef", paidEvent.saleRef as string)).take(2),
      paidEvent.orderRef
        ? ctx.db.query("bookings").withIndex("by_orderRef", (q) => q.eq("orderRef", paidEvent.orderRef as string)).take(2)
        : ctx.db.query("bookings").withIndex("by_saleRef", (q) => q.eq("saleRef", paidEvent.saleRef as string)).take(2)
    ]);
    if (entities.length > 1 || ownerBookings.length > 1) {
      return recordUnverifiedRefund(ctx, args, "refund_owner_records_duplicate", owner);
    }
    const entity: Doc<"orders"> | Doc<"posSales"> | undefined = entities[0];
    const ownerBooking: Doc<"bookings"> | undefined = ownerBookings[0];
    if (paidEvent.orderRef) {
      const order = entity as Doc<"orders"> | undefined;
      if (
        !order ||
        !(order.status === "paid" || (order.status === "canceled" && activeInvalidation)) ||
        order.expectedProvider !== "stripe" ||
        order.totalCents !== paidEvent.amountCents ||
        order.currency !== paidEvent.currency
      ) {
        await insertWebhookEvent(ctx, {
          providerEventId: args.providerEventId,
          eventType: args.eventType,
          status: "failed",
          orderRef: paidEvent.orderRef,
          raw: { ...(args.raw ?? {}), reason: "paid_order_not_refundable" }
        });
        return { status: "failed", duplicate: false, orderRef: paidEvent.orderRef };
      }
    } else {
      const sale = entity as Doc<"posSales"> | undefined;
      if (
        !sale ||
        !(sale.status === "paid" || (sale.status === "canceled" && activeInvalidation)) ||
        sale.totalCents !== paidEvent.amountCents ||
        sale.currency !== paidEvent.currency
      ) {
        await insertWebhookEvent(ctx, {
          providerEventId: args.providerEventId,
          eventType: args.eventType,
          status: "failed",
          saleRef: paidEvent.saleRef,
          raw: { ...(args.raw ?? {}), reason: "paid_pos_sale_not_refundable" }
        });
        return { status: "failed", duplicate: false, saleRef: paidEvent.saleRef };
      }
    }
    if (args.currency !== paidEvent.currency || args.amountCents > paidEvent.amountCents) {
      await insertWebhookEvent(ctx, {
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "failed",
        orderRef: paidEvent.orderRef,
        saleRef: paidEvent.saleRef,
        raw: { ...(args.raw ?? {}), reason: "refund_amount_or_currency_mismatch" }
      });
      return { status: "failed", duplicate: false, orderRef: paidEvent.orderRef, saleRef: paidEvent.saleRef };
    }

    const existingRefunds = await ctx.db
      .query("refunds")
      .withIndex("by_providerRefundId", (q) => q.eq("providerRefundId", args.providerRefundId as string))
      .take(2);
    if (existingRefunds.length > 1) return recordUnverifiedRefund(ctx, args, "refund_record_duplicate", owner);
    const existingRefund = existingRefunds[0];
    if (
      existingRefund &&
      (existingRefund.providerPaymentIntentId !== args.providerPaymentIntentId ||
        existingRefund.paymentProvider !== paidEvent.provider ||
        existingRefund.orderRef !== paidEvent.orderRef ||
        existingRefund.saleRef !== paidEvent.saleRef ||
        existingRefund.amountCents !== args.amountCents ||
        existingRefund.currency !== args.currency)
    ) {
      await insertWebhookEvent(ctx, {
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "failed",
        orderRef: paidEvent.orderRef,
        saleRef: paidEvent.saleRef,
        raw: { ...(args.raw ?? {}), reason: "refund_identity_conflict" }
      });
      return { status: "failed", duplicate: false, orderRef: paidEvent.orderRef, saleRef: paidEvent.saleRef };
    }

    if (existingRefund && existingRefund.providerEventCreatedAt > args.providerEventCreatedAt) {
      await insertWebhookEvent(ctx, {
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "processed",
        orderRef: paidEvent.orderRef,
        saleRef: paidEvent.saleRef,
        raw: { ...(args.raw ?? {}), reason: "stale_refund_event_ignored" }
      });
      return {
        status: "processed",
        duplicate: false,
        stale: true,
        orderRef: paidEvent.orderRef,
        saleRef: paidEvent.saleRef
      };
    }
    if (existingRefund && !refundStatusTransitionAllowed(existingRefund.status, args.refundStatus)) {
      const reason =
        existingRefund.status === args.refundStatus
          ? "refund_state_unchanged"
          : finalRefundStatuses.has(existingRefund.status)
            ? "final_refund_state_change_ignored"
            : "unsupported_refund_state_transition_ignored";
      await insertWebhookEvent(ctx, {
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "processed",
        orderRef: paidEvent.orderRef,
        saleRef: paidEvent.saleRef,
        raw: { ...(args.raw ?? {}), reason }
      });
      return {
        status: "processed",
        duplicate: false,
        stale: true,
        orderRef: paidEvent.orderRef,
        saleRef: paidEvent.saleRef
      };
    }

    // Bounded succeeded history: a cumulative sum is never inferred from a
    // prefix, so an overflow changes nothing and stays visible for staff.
    const refunds = await ctx.db
      .query("refunds")
      .withIndex("by_providerPaymentIntentId_status", (q) =>
        q.eq("providerPaymentIntentId", args.providerPaymentIntentId as string).eq("status", "succeeded")
      )
      .take(refundHistoryReadLimit + 1);
    if (refunds.length > refundHistoryReadLimit) {
      return recordUnverifiedRefund(ctx, args, "refund_history_unverified", owner);
    }
    const refundIds = new Set<string>();
    let succeededRefundedCents = args.refundStatus === "succeeded" ? args.amountCents : 0;
    for (const refund of refunds) {
      // A negative, foreign or duplicated refund cannot offset real returned
      // money and restore admission. Keep the current provider facts visible
      // without changing fulfillment when the cumulative evidence is unknown.
      if (
        refund.providerPaymentIntentId !== args.providerPaymentIntentId ||
        refund.paymentProvider !== paidEvent.provider ||
        refund.orderRef !== paidEvent.orderRef || refund.saleRef !== paidEvent.saleRef ||
        refund.currency !== paidEvent.currency ||
        !Number.isSafeInteger(refund.amountCents) || refund.amountCents <= 0 ||
        !refund.providerRefundId || refundIds.has(refund.providerRefundId)
      ) {
        return recordUnverifiedRefund(ctx, args, "refund_history_invalid", owner);
      }
      refundIds.add(refund.providerRefundId);
      if (existingRefund && refund._id === existingRefund._id) continue;
      succeededRefundedCents += refund.amountCents;
      if (!Number.isSafeInteger(succeededRefundedCents)) {
        return recordUnverifiedRefund(ctx, args, "refund_history_invalid", owner);
      }
    }
    if (succeededRefundedCents > paidEvent.amountCents) {
      await insertWebhookEvent(ctx, {
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "failed",
        orderRef: paidEvent.orderRef,
        saleRef: paidEvent.saleRef,
        raw: { ...(args.raw ?? {}), reason: "cumulative_refund_exceeds_payment" }
      });
      return { status: "failed", duplicate: false, orderRef: paidEvent.orderRef, saleRef: paidEvent.saleRef };
    }

    const now = Date.now();
    const refundDocument = withoutUndefined({
      providerRefundId: args.providerRefundId,
      providerPaymentIntentId: args.providerPaymentIntentId,
      paymentProvider: paidEvent.provider as "stripe" | "terminal",
      orderRef: paidEvent.orderRef,
      saleRef: paidEvent.saleRef,
      status: args.refundStatus as StripeRefundStatus,
      amountCents: args.amountCents,
      currency: args.currency,
      reason: args.reason,
      failureReason: args.failureReason,
      providerEventCreatedAt: args.providerEventCreatedAt,
      rawEventId: args.providerEventId,
      updatedAt: now
    });
    if (existingRefund) await ctx.db.patch(existingRefund._id, refundDocument);
    else await ctx.db.insert("refunds", { ...refundDocument, createdAt: now });

    await reconcileRefundFulfillment(ctx, {
      providerPaymentIntentId: args.providerPaymentIntentId,
      orderRef: paidEvent.orderRef,
      saleRef: paidEvent.saleRef,
      paidAmountCents: paidEvent.amountCents,
      cumulativeSucceededRefundedCents: succeededRefundedCents,
      entity: entity!,
      booking: ownerBooking,
      activeInvalidation,
      now
    });

    await ctx.db.insert("auditEvents", {
      action: "payment.refund.reconciled",
      entityType: paidEvent.orderRef ? "order" : "posSale",
      entityRef: paidEvent.orderRef ?? paidEvent.saleRef!,
      metadata: {
        providerRefundId: args.providerRefundId,
        providerPaymentIntentId: args.providerPaymentIntentId,
        amountCents: args.amountCents,
        status: args.refundStatus,
        cumulativeSucceededRefundedCents: succeededRefundedCents
      },
      createdAt: now
    });
    await insertWebhookEvent(ctx, {
      providerEventId: args.providerEventId,
      eventType: args.eventType,
      status: "processed",
      orderRef: paidEvent.orderRef,
      saleRef: paidEvent.saleRef,
      raw: args.raw
    });
    return {
      status: "processed",
      duplicate: false,
      stale: false,
      orderRef: paidEvent.orderRef,
      saleRef: paidEvent.saleRef
    };
  }
});

function refundStatusTransitionAllowed(from: StripeRefundStatus, to: StripeRefundStatus) {
  if (from === to) return false;
  if (from === "failed" || from === "canceled") return false;
  if (from === "succeeded") return to === "requires_action" || to === "failed";
  return true;
}

type RefundFulfillmentEntityType = "order" | "posSale";
type RefundFulfillmentInvalidation = {
  auditEventId: Id<"auditEvents">;
  createdAt: number;
  metadata?: Record<string, string | number | boolean>;
};

// Invalidation/restoration audit rows per entity; more is unprovable history.
const refundAuditReadLimit = 100;
const refundHistoryReadLimit = 100;

/**
 * The refund invalidation that currently owns an entity's cancellation, read
 * through the action index (bounded): only invalidation and restoration rows
 * are read, never unrelated audit history. Overflow is "unverified", never
 * "no active invalidation".
 */
async function findActiveRefundFulfillmentInvalidation(
  ctx: MutationCtx,
  args: {
    entityType: RefundFulfillmentEntityType;
    entityRef: string;
    providerPaymentIntentId: string;
  }
): Promise<{ kind: "ok"; active?: RefundFulfillmentInvalidation } | { kind: "unverified" }> {
  const [invalidated, restored] = await Promise.all(
    [refundFulfillmentInvalidatedAction, refundFulfillmentRestoredAction].map((action) =>
      ctx.db
        .query("auditEvents")
        .withIndex("by_entity_action", (q) =>
          q.eq("entityType", args.entityType).eq("entityRef", args.entityRef).eq("action", action)
        )
        .take(refundAuditReadLimit + 1)
    )
  );
  if (invalidated.length > refundAuditReadLimit || restored.length > refundAuditReadLimit) return { kind: "unverified" };
  let active: RefundFulfillmentInvalidation | undefined;
  const ordered = [...invalidated, ...restored].toSorted(
    (left, right) => left.createdAt - right.createdAt || left._creationTime - right._creationTime
  );
  for (const event of ordered) {
    if (event.metadata?.providerPaymentIntentId !== args.providerPaymentIntentId) continue;
    if (event.action === refundFulfillmentInvalidatedAction) {
      active = { auditEventId: event._id, createdAt: event.createdAt, metadata: event.metadata };
    } else {
      active = undefined;
    }
  }
  return { kind: "ok", active };
}

/**
 * A provider refund event whose owner or history cannot be proven: nothing
 * is cancelled, restored or released. The event is durably received (failed
 * webhook record with its raw facts) and an open billing exception carries
 * the refund facts for staff.
 */
async function recordUnverifiedRefund(
  ctx: MutationCtx,
  args: {
    providerEventId: string;
    eventType: string;
    providerRefundId?: string;
    providerPaymentIntentId?: string;
    refundStatus?: string;
    amountCents?: number;
    currency?: "usd";
    reason?: string;
    failureReason?: string;
    providerEventCreatedAt?: number;
    raw?: unknown;
  },
  code: string,
  owner: { orderRef?: string; saleRef?: string }
) {
  await openOperationsException(ctx, {
    category: "billing",
    code,
    dedupeKey: `billing:${code}:refund:${args.providerRefundId}`,
    moneyReceived: true,
    orderRef: owner.orderRef,
    saleRef: owner.saleRef,
    providerPaymentIntentId: args.providerPaymentIntentId,
    providerEventId: args.providerEventId,
    amountCents: args.amountCents,
    currency: args.currency,
    evidence: {
      providerRefundId: args.providerRefundId,
      refundStatus: args.refundStatus,
      refundReason: args.reason,
      failureReason: args.failureReason,
      providerEventCreatedAt: args.providerEventCreatedAt
    },
    now: Date.now()
  });
  await insertWebhookEvent(ctx, {
    providerEventId: args.providerEventId,
    eventType: args.eventType,
    status: "failed",
    orderRef: owner.orderRef,
    saleRef: owner.saleRef,
    raw: { ...((args.raw as Record<string, unknown> | undefined) ?? {}), reason: code }
  });
  return { status: "failed", duplicate: false, orderRef: owner.orderRef, saleRef: owner.saleRef };
}

async function reconcileRefundFulfillment(
  ctx: MutationCtx,
  args: {
    providerPaymentIntentId: string;
    orderRef?: string;
    saleRef?: string;
    paidAmountCents: number;
    cumulativeSucceededRefundedCents: number;
    /** Preflighted before any write in this transaction. */
    entity: Doc<"orders"> | Doc<"posSales">;
    booking: Doc<"bookings"> | undefined;
    activeInvalidation: RefundFulfillmentInvalidation | undefined;
    now: number;
  }
) {
  const entityType: RefundFulfillmentEntityType = args.orderRef ? "order" : "posSale";
  const entityRef = args.orderRef ?? args.saleRef!;
  const { entity, booking, activeInvalidation } = args;

  if (args.cumulativeSucceededRefundedCents === args.paidAmountCents) {
    if (activeInvalidation) return;

    const entityStatusChanged = entity.status === "paid";
    const bookingStatusChanged = Boolean(booking && booking.status !== "cancelled");
    const bookingPreviousStatus = booking?.status;
    const bookingPreviousCheckedInAt = booking?.checkedInAt;
    const bookingPreviousCancelledAt = booking?.cancelledAt;
    const invalidationId = await ctx.db.insert("auditEvents", {
      action: refundFulfillmentInvalidatedAction,
      entityType,
      entityRef,
      metadata: scalarMetadata({
        providerPaymentIntentId: args.providerPaymentIntentId,
        cumulativeSucceededRefundedCents: args.cumulativeSucceededRefundedCents,
        entityStatusChanged,
        entityUpdatedAt: entityStatusChanged ? args.now : undefined,
        bookingStatusChanged,
        bookingRef: booking?.bookingRef,
        bookingPreviousStatus: bookingStatusChanged ? bookingPreviousStatus : undefined,
        bookingPreviousCheckedInAt: bookingStatusChanged ? bookingPreviousCheckedInAt : undefined,
        bookingPreviousCancelledAt: bookingStatusChanged ? bookingPreviousCancelledAt : undefined,
        bookingUpdatedAt: bookingStatusChanged ? args.now : undefined
      }),
      createdAt: args.now
    });
    if (entityStatusChanged) {
      await ctx.db.patch(entity._id, { status: "canceled", updatedAt: args.now });
    }
    if (booking && bookingStatusChanged) {
      // Status ownership belongs to this immutable audit record. Physical
      // departure updates can change updatedAt without changing this owner.
      await ctx.db.patch(booking._id, {
        status: "cancelled",
        cancelledAt: args.now,
        refundCancellationOwner: invalidationId,
        updatedAt: args.now
      });
    }
    return;
  }

  if (!activeInvalidation) return;

  const metadata = activeInvalidation.metadata ?? {};
  const expectedEntityUpdatedAt = numericMetadata(metadata.entityUpdatedAt);
  const entityRestored =
    metadata.entityStatusChanged === true &&
    entity.status === "canceled" &&
    expectedEntityUpdatedAt !== undefined &&
    entity.updatedAt === expectedEntityUpdatedAt;
  if (entityRestored) {
    await ctx.db.patch(entity._id, { status: "paid", updatedAt: args.now });
  }

  const previousBookingStatus = stringMetadata(metadata.bookingPreviousStatus);
  const bookingRestored = Boolean(
    booking &&
      metadata.bookingStatusChanged === true &&
      booking.status === "cancelled" &&
      booking.bookingRef === metadata.bookingRef &&
      previousBookingStatus &&
      previousBookingStatus !== "cancelled" &&
      booking.refundCancellationOwner === activeInvalidation.auditEventId
  );
  let ticketDeliveryRequeued = false;
  if (booking && bookingRestored) {
    await ctx.db.patch(booking._id, {
      status: previousBookingStatus!,
      checkedInAt: booking.checkedInAt ?? numericMetadata(metadata.bookingPreviousCheckedInAt),
      cancelledAt: numericMetadata(metadata.bookingPreviousCancelledAt),
      refundCancellationOwner: undefined,
      updatedAt: args.now
    });
    // Only a single stored delivery is requeued; duplicates are left alone
    // (and still fail the send-time proof) rather than throwing after writes.
    const deliveries = await ctx.db
      .query("ticketDeliveries")
      .withIndex("by_bookingRef", (q) => q.eq("bookingRef", booking.bookingRef))
      .take(2);
    const ticketDelivery = deliveries.length === 1 ? deliveries[0] : undefined;
    if (
      ticketDelivery?.status === "suppressed" &&
      ticketDelivery.failureReason === "booking_cancelled"
    ) {
      await ctx.db.patch(ticketDelivery._id, {
        status: "queued",
        failureReason: undefined,
        providerMessageId: undefined,
        lastAttemptAt: undefined,
        sentAt: undefined,
        updatedAt: args.now
      });
      await ctx.scheduler.runAfter(0, sendTicketConfirmationAction, {
        deliveryId: ticketDelivery._id
      });
      ticketDeliveryRequeued = true;
    }
  }

  await ctx.db.insert("auditEvents", {
    action: refundFulfillmentRestoredAction,
    entityType,
    entityRef,
    metadata: scalarMetadata({
      providerPaymentIntentId: args.providerPaymentIntentId,
      cumulativeSucceededRefundedCents: args.cumulativeSucceededRefundedCents,
      entityRestored,
      bookingRef: booking?.bookingRef,
      bookingRestored,
      ticketDeliveryRequeued
    }),
    createdAt: args.now
  });
}

function numericMetadata(value: string | number | boolean | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringMetadata(value: string | number | boolean | undefined) {
  return typeof value === "string" && value ? value : undefined;
}

function scalarMetadata(value: Record<string, string | number | boolean | undefined>) {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
  );
}

export const recordStripeCheckoutWebhook = internalMutation({
  args: {
    providerEventId: v.string(),
    eventType: v.string(),
    outcome: v.union(v.literal("paid"), v.literal("failed"), v.literal("canceled"), v.literal("ignored")),
    providerPaymentId: v.optional(v.string()),
    providerPaymentIntentId: v.optional(v.string()),
    orderRef: v.optional(v.string()),
    ticketCode: v.optional(v.string()),
    amountCents: v.optional(v.number()),
    currency: v.optional(v.literal("usd")),
    attemptNonce: v.optional(v.string()),
    sessionMode: v.optional(v.string()),
    livemode: v.optional(v.boolean()),
    sessionStatus: v.optional(v.string()),
    paymentStatus: v.optional(v.string()),
    // Signed Stripe event creation time (ms): the trusted time of payment.
    providerEventCreatedAt: v.optional(v.number()),
    raw: v.optional(v.any())
  },
  handler: async (ctx, args) => {
    const existingWebhook = await ctx.db
      .query("webhookEvents")
      .withIndex("by_provider_providerEventId", (q) =>
        q.eq("provider", "stripe").eq("providerEventId", args.providerEventId)
      )
      .first();
    if (existingWebhook) {
      await repairDuplicatePaidCheckoutDelivery(ctx, args, existingWebhook);
      return {
        status: existingWebhook.status,
        duplicate: true,
        orderRef: existingWebhook.orderRef
      };
    }

    if (args.outcome === "ignored") {
      await insertWebhookEvent(ctx, {
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "ignored",
        orderRef: args.orderRef,
        raw: args.raw
      });
      return { status: "ignored", duplicate: false, orderRef: args.orderRef };
    }

    if (!args.providerPaymentId || !args.orderRef) {
      await insertWebhookEvent(ctx, {
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "failed",
        orderRef: args.orderRef,
        raw: { ...(args.raw ?? {}), reason: "missing_provider_payment_or_order_ref" }
      });
      return { status: "failed", duplicate: false, orderRef: args.orderRef };
    }

    const now = Date.now();
    if (args.outcome === "paid") {
      const result = await settleCheckoutPaid(ctx, {
        source: "webhook",
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        providerSessionId: args.providerPaymentId,
        providerPaymentIntentId: args.providerPaymentIntentId,
        orderRef: args.orderRef,
        attemptNonce: args.attemptNonce,
        amountCents: args.amountCents,
        currency: args.currency,
        sessionMode: args.sessionMode,
        livemode: args.livemode,
        sessionStatus: args.sessionStatus,
        paymentStatus: args.paymentStatus,
        paidAt: args.providerEventCreatedAt,
        ticketCode: args.ticketCode,
        raw: args.raw
      }, now);
      if (result.kind === "fulfilled") {
        await insertWebhookEvent(ctx, {
          providerEventId: args.providerEventId,
          eventType: args.eventType,
          status: "processed",
          orderRef: args.orderRef,
          raw: args.raw
        });
        return { status: "processed", duplicate: false, orderRef: args.orderRef };
      }
      // Paid evidence that cannot become a ticket is durably recorded as a
      // billing exception; the webhook itself is stored as not fulfilled.
      await insertWebhookEvent(ctx, {
        providerEventId: args.providerEventId,
        eventType: args.eventType,
        status: "failed",
        orderRef: args.orderRef,
        raw: {
          ...(args.raw ?? {}),
          reason: result.kind === "exception" ? result.code : result.reason,
          ...(result.kind === "exception" ? { billingException: true, moneyRecorded: result.moneyRecorded } : {})
        }
      });
      return { status: "failed", duplicate: false, orderRef: args.orderRef };
    }

    const result = await settleCheckoutUnpaid(ctx, {
      source: "webhook",
      providerEventId: args.providerEventId,
      eventType: args.eventType,
      outcome: args.outcome,
      providerSessionId: args.providerPaymentId,
      orderRef: args.orderRef,
      attemptNonce: args.attemptNonce,
      amountCents: args.amountCents,
      currency: args.currency,
      sessionStatus: args.sessionStatus,
      paymentStatus: args.paymentStatus,
      sessionMode: args.sessionMode,
      livemode: args.livemode,
      raw: args.raw
    }, now);
    await insertWebhookEvent(ctx, {
      providerEventId: args.providerEventId,
      eventType: args.eventType,
      status: result.kind === "released" ? "processed" : "failed",
      orderRef: args.orderRef,
      raw: result.kind === "released" ? args.raw : { ...(args.raw ?? {}), reason: result.reason }
    });
    return {
      status: result.kind === "released" ? "processed" : "failed",
      duplicate: false,
      orderRef: args.orderRef
    };
  }
});

async function repairDuplicatePaidCheckoutDelivery(
  ctx: MutationCtx,
  args: {
    outcome: "paid" | "failed" | "canceled" | "ignored";
    orderRef?: string;
    ticketCode?: string;
  },
  existingWebhook: { status: "processed" | "ignored" | "failed"; orderRef?: string }
) {
  if (
    args.outcome !== "paid" ||
    existingWebhook.status !== "processed" ||
    !args.ticketCode ||
    !args.orderRef ||
    existingWebhook.orderRef !== args.orderRef
  ) {
    return;
  }

  const [order, booking] = await Promise.all([
    ctx.db
      .query("orders")
      .withIndex("by_orderRef", (q) => q.eq("orderRef", args.orderRef as string))
      .unique(),
    ctx.db
      .query("bookings")
      .withIndex("by_orderRef", (q) => q.eq("orderRef", args.orderRef as string))
      .unique()
  ]);
  if (
    order?.status !== "paid" ||
    !booking ||
    booking.status !== "confirmed" ||
    (await hasOpenBillingExceptionForOrder(ctx, args.orderRef))
  ) {
    return;
  }

  await ensureTicketDelivery(ctx, {
    ticketCode: args.ticketCode,
    bookingRef: booking.bookingRef,
    orderRef: args.orderRef,
    emailLower: booking.emailLower,
    now: Date.now()
  });
}

async function repairDuplicatePaidTerminalDelivery(
  ctx: MutationCtx,
  args: {
    outcome: "paid" | "failed" | "canceled" | "ignored";
    saleRef?: string;
    ticketCode?: string;
  },
  existingWebhook: { status: "processed" | "ignored" | "failed"; saleRef?: string }
) {
  if (
    args.outcome !== "paid" ||
    existingWebhook.status !== "processed" ||
    !args.ticketCode ||
    !args.saleRef ||
    existingWebhook.saleRef !== args.saleRef
  ) {
    return;
  }

  const [sale, booking] = await Promise.all([
    ctx.db
      .query("posSales")
      .withIndex("by_saleRef", (q) => q.eq("saleRef", args.saleRef as string))
      .unique(),
    ctx.db
      .query("bookings")
      .withIndex("by_saleRef", (q) => q.eq("saleRef", args.saleRef as string))
      .unique()
  ]);
  // Only a confirmed booking for its sale's stored selected visit, with no
  // open billing exception and a valid delivery shape, is repaired.
  if (
    sale?.status !== "paid" ||
    !booking ||
    booking.status !== "confirmed" ||
    !sale.visitDate ||
    !sale.entryTime ||
    booking.visitDate !== sale.visitDate ||
    booking.entryTime !== sale.entryTime ||
    (await hasOpenBillingExceptionForSale(ctx, args.saleRef))
  ) {
    return;
  }
  const now = Date.now();
  try {
    await assertTicketDeliveryReady(ctx, {
      ticketCode: args.ticketCode, bookingRef: booking.bookingRef,
      saleRef: args.saleRef, emailLower: booking.emailLower, now
    });
  } catch {
    return;
  }
  await ensureTicketDelivery(ctx, {
    ticketCode: args.ticketCode,
    bookingRef: booking.bookingRef,
    saleRef: args.saleRef,
    emailLower: booking.emailLower,
    now
  });
}

async function insertWebhookEvent(
  ctx: MutationCtx,
  args: {
    provider?: "stripe" | "terminal";
    providerEventId: string;
    eventType: string;
    status: "processed" | "ignored" | "failed";
    orderRef?: string;
    saleRef?: string;
    raw?: unknown;
  }
) {
  await ctx.db.insert("webhookEvents", withoutUndefined({
    provider: args.provider ?? "stripe",
    providerEventId: args.providerEventId,
    eventType: args.eventType,
    processedAt: Date.now(),
    status: args.status,
    orderRef: args.orderRef,
    saleRef: args.saleRef,
    raw: args.raw
  }));
}

async function insertTerminalWebhookAuditEvent(
  ctx: MutationCtx,
  args: {
    saleRef: string;
    outcome: "paid" | "failed" | "canceled";
    amountCents: number;
    providerPaymentId: string;
    providerEventId: string;
    eventType: string;
    createdAt: number;
  }
) {
  await ctx.db.insert("auditEvents", {
    action: `pos.terminalWebhook.${args.outcome}`,
    entityType: "posSale",
    entityRef: args.saleRef,
    metadata: {
      amountCents: args.amountCents,
      providerPaymentId: args.providerPaymentId,
      providerEventId: args.providerEventId,
      eventType: args.eventType,
      status: args.outcome
    },
    createdAt: args.createdAt
  });
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
