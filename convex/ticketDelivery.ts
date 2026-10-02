import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { venueClock, visitEntitlementWindow } from "@skyla/payments";

import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx
} from "./_generated/server";
import { requireStaffUser } from "./lib/auth";
import { assertBookingPaid } from "./lib/admission";
import { loadVenueHours } from "./lib/capacity";
import { bookingAdmission } from "./lib/occupancy";
import { openBillingExceptionsForOrder, openOperationsException, resolveOperationsException } from "./lib/operationsExceptions";
import { normalizeTicketCode } from "./lib/ticketDelivery";
import { providerConfigurationFingerprint } from "./lib/providerIdentity";
import { scheduleDeliveryTracking } from "./lib/ticketDeliveryTracking";

declare const process: { env: Record<string, string | undefined> };

type DeliveryDoc = Doc<"ticketDeliveries">;

// Resend keeps idempotency keys for 24 hours. Automatic retries with the same
// key stop well before that; after it, an unknown outcome needs a person,
// because a retry could deliver a second email.
export const resendIdempotencyRetentionMs = 24 * 60 * 60 * 1000;
export const deliveryAutoRetryWindowMs = 20 * 60 * 60 * 1000;
export const deliveryMaxAutoRetries = 8;
const deliveryRetryBackoffMs = [1, 2, 5, 15, 30, 60, 120, 240].map((minutes) => minutes * 60 * 1000);
const queuedDeliveryGraceMs = 2 * 60 * 1000;
const retryableFailureReasons = new Set(["email_delivery_outcome_unknown", "email_provider_429"]);
const sweepBatchSize = 25;

type DeliveryPayload = {
  deliveryId: Id<"ticketDeliveries">;
  ticketCode: string;
  bookingRef: string;
  emailLower: string;
  visitDate?: string;
  entryTime?: string;
  partySize?: number;
  attemptCount: number;
  sendVersion: number;
};

const claimDeliveryMutation = makeFunctionReference<
  "mutation",
  { deliveryId: Id<"ticketDeliveries">; providerConfigurationFingerprint?: string },
  DeliveryPayload | null
>("ticketDelivery:claimTicketDelivery");
const recordDeliverySentMutation = makeFunctionReference<
  "mutation",
  {
    deliveryId: Id<"ticketDeliveries">;
    providerMessageId: string;
    attemptCount: number;
    sendVersion: number;
  },
  null
>("ticketDelivery:recordTicketDeliverySent");
const recordDeliveryFailureMutation = makeFunctionReference<
  "mutation",
  {
    deliveryId: Id<"ticketDeliveries">;
    failureReason: string;
    attemptCount: number;
    sendVersion: number;
  },
  null
>("ticketDelivery:recordTicketDeliveryFailure");
const sendTicketConfirmationAction = makeFunctionReference<
  "action",
  { deliveryId: Id<"ticketDeliveries"> },
  null
>("ticketDelivery:sendTicketConfirmation");
const recordDeliveryUnconfiguredMutation = makeFunctionReference<
  "mutation",
  { deliveryId: Id<"ticketDeliveries">; reason: string },
  null
>("ticketDelivery:recordTicketDeliveryUnconfigured");

const sendingLeaseMs = 5 * 60 * 1000;

export const getTicket = query({
  args: { ticketCode: v.string() },
  handler: async (ctx, args) => {
    const ticketCode = normalizeTicketCode(args.ticketCode);
    const delivery = await ctx.db
      .query("ticketDeliveries")
      .withIndex("by_ticketCode", (q) => q.eq("ticketCode", ticketCode))
      .unique();
    if (!delivery) throw new Error("Ticket was not found");

    const booking = await ctx.db
      .query("bookings")
      .withIndex("by_bookingRef", (q) => q.eq("bookingRef", delivery.bookingRef))
      .unique();
    if (!booking) throw new Error("Ticket was not found");

    const billingBlocked = delivery.orderRef && (await openBillingExceptionsForOrder(ctx, delivery.orderRef)).length > 0;
    let status = billingBlocked ? "needs-attention" : booking.status;
    if (status === "confirmed") {
      const redeemed = booking.checkedInAt !== undefined || await bookingAdmission(ctx, booking.bookingRef);
      if (redeemed) status = "checked-in";
      else {
        try {
          await assertBookingPaid(ctx, booking);
          const now = venueClock(Date.now());
          const hours = await loadVenueHours(ctx);
          const window = booking.visitDate && booking.entryTime ? visitEntitlementWindow(hours, booking.visitDate, booking.entryTime) : null;
          if (!window || !booking.visitDate) status = "needs-attention";
          else if (now.date > booking.visitDate || (now.date === booking.visitDate && now.minutes >= window.endMinutes)) status = "expired";
        } catch { status = "needs-attention"; }
      }
    }
    return {
      ticketCode: delivery.ticketCode,
      bookingRef: booking.bookingRef,
      status,
      visitDate: booking.visitDate,
      entryTime: booking.entryTime,
      partySize: booking.partySize
    };
  }
});

export const getTicketDeliveryForBooking = query({
  args: { bookingRef: v.string() },
  handler: async (ctx, args) => {
    await requireStaffUser(ctx, ["admin", "pos"]);
    const bookingRef = requiredText(args.bookingRef, "bookingRef", 80);
    const delivery = await ctx.db
      .query("ticketDeliveries")
      .withIndex("by_bookingRef", (q) => q.eq("bookingRef", bookingRef))
      .unique();
    if (!delivery) return null;
    return projectStaffDelivery(delivery);
  }
});

export const requestTicketResend = mutation({
  args: { bookingRef: v.string() },
  handler: async (ctx, args) => {
    const staff = await requireStaffUser(ctx, ["admin"]);
    const bookingRef = requiredText(args.bookingRef, "bookingRef", 80);
    const delivery = await ctx.db
      .query("ticketDeliveries")
      .withIndex("by_bookingRef", (q) => q.eq("bookingRef", bookingRef))
      .unique();
    if (!delivery) throw new Error("Ticket delivery was not found");
    const booking = await ctx.db
      .query("bookings")
      .withIndex("by_bookingRef", (q) => q.eq("bookingRef", bookingRef))
      .unique();
    if (!booking) throw new Error("Ticket booking was not found");
    if (booking.status === "cancelled") {
      throw new Error("Cancelled bookings cannot resend tickets");
    }
    if (!delivery.emailLower) throw new Error("Ticket delivery has no customer email");

    const now = Date.now();
    const activeSend =
      delivery.status === "sending" &&
      delivery.lastAttemptAt !== undefined &&
      now - delivery.lastAttemptAt < sendingLeaseMs;
    if (activeSend) throw new Error("Ticket delivery is already sending");

    // A stale send reuses its provider idempotency key. This recovers an
    // unknown provider outcome without risking a second customer email, as
    // long as the provider still remembers that key. After the retention
    // window the admin's explicit resend uses a new version and is audited.
    const recoveringStaleSend = delivery.status === "sending";
    const recoveringUnknownOutcome =
      delivery.status === "failed" &&
      (delivery.failureReason === "email_delivery_outcome_unknown" ||
        delivery.failureReason === "email_delivery_unknown_after_idempotency_window");
    const keyStillRetained =
      delivery.providerKeyFirstUsedAt === undefined ||
      now - delivery.providerKeyFirstUsedAt < deliveryAutoRetryWindowMs;
    const recoveringExistingAttempt = (recoveringStaleSend || recoveringUnknownOutcome) && keyStillRetained;
    const nextSendVersion = recoveringExistingAttempt ? delivery.sendVersion : delivery.sendVersion + 1;
    const queuedDelivery = {
      ...delivery,
      status: "queued",
      sendVersion: nextSendVersion,
      failureReason: undefined,
      providerMessageId: undefined,
      lastAttemptAt: undefined,
      sentAt: undefined,
      updatedAt: now
    } as const;
    await ctx.db.patch(delivery._id, {
      status: queuedDelivery.status,
      sendVersion: queuedDelivery.sendVersion,
      failureReason: queuedDelivery.failureReason,
      providerMessageId: queuedDelivery.providerMessageId,
      lastAttemptAt: queuedDelivery.lastAttemptAt,
      sentAt: queuedDelivery.sentAt,
      autoRetryAt: undefined,
      autoRetryCount: 0,
      ...(recoveringExistingAttempt ? {} : { providerKeyFirstUsedAt: undefined }),
      ...(recoveringExistingAttempt ? {} : { providerConfigurationFingerprint: undefined }),
      providerDeliveryStatus: undefined,
      providerStatusAt: undefined,
      deliveredAt: undefined,
      providerTrackingAt: undefined,
      providerTrackingCount: 0,
      providerTrackingLease: undefined,
      providerTrackingLeaseExpiresAt: undefined,
      updatedAt: queuedDelivery.updatedAt
    });
    await ctx.db.insert("auditEvents", {
      actorStaffUserId: staff._id,
      action: "ticket.deliveryResendRequested",
      entityType: "ticketDelivery",
      entityRef: delivery.bookingRef,
      metadata: {
        bookingRef: delivery.bookingRef,
        sendVersion: nextSendVersion,
        recovery: recoveringExistingAttempt,
        ...(recoveringExistingAttempt
          ? {
              recoveryReason: recoveringStaleSend
                ? "expired_sending_lease"
                : "unknown_provider_outcome"
            }
          : (recoveringStaleSend || recoveringUnknownOutcome)
            ? { recoveryReason: "idempotency_window_elapsed_new_version" }
            : {})
      },
      createdAt: now
    });
    await ctx.scheduler.runAfter(0, sendTicketConfirmationAction, { deliveryId: delivery._id });
    return projectStaffDelivery(queuedDelivery);
  }
});

export const claimTicketDelivery = internalMutation({
  args: { deliveryId: v.id("ticketDeliveries"), providerConfigurationFingerprint: v.optional(v.string()) },
  handler: async (ctx, args): Promise<DeliveryPayload | null> => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery || delivery.status === "sent" || delivery.status === "suppressed") return null;
    const now = Date.now();
    if (
      delivery.status === "sending" &&
      delivery.lastAttemptAt !== undefined &&
      now - delivery.lastAttemptAt < sendingLeaseMs
    ) {
      return null;
    }
    // A failed delivery is only retried when automation scheduled it; staff
    // requeue it explicitly otherwise.
    if (delivery.status === "failed" && (delivery.autoRetryAt === undefined || delivery.autoRetryAt > now)) {
      return null;
    }
    if (!delivery.emailLower) {
      await ctx.db.patch(delivery._id, {
        status: "suppressed",
        failureReason: "customer_email_missing",
        autoRetryAt: undefined,
        updatedAt: now
      });
      return null;
    }
    const booking = await ctx.db
      .query("bookings")
      .withIndex("by_bookingRef", (q) => q.eq("bookingRef", delivery.bookingRef))
      .unique();
    if (!booking) {
      await ctx.db.patch(delivery._id, {
        status: "failed",
        failureReason: "booking_missing",
        autoRetryAt: undefined,
        updatedAt: now
      });
      return null;
    }
    if (booking.status === "cancelled") {
      await ctx.db.patch(delivery._id, {
        status: "suppressed",
        failureReason: "booking_cancelled",
        autoRetryAt: undefined,
        updatedAt: now
      });
      return null;
    }
    // Tickets go only to confirmed bookings whose money is recorded as paid.
    const unpaidReason = await deliveryPaymentBlocker(ctx, delivery, booking);
    if (unpaidReason) {
      await ctx.db.patch(delivery._id, {
        status: "suppressed",
        failureReason: unpaidReason,
        autoRetryAt: undefined,
        updatedAt: now
      });
      return null;
    }
    if (
      delivery.providerKeyFirstUsedAt !== undefined &&
      now - delivery.providerKeyFirstUsedAt >= deliveryAutoRetryWindowMs
    ) {
      // The provider may have forgotten this key; sending now could deliver
      // a second email. A person decides instead.
      await raiseDeliveryException(ctx, delivery, "email_delivery_unknown_after_idempotency_window", now);
      return null;
    }

    if (args.providerConfigurationFingerprint && delivery.providerKeyFirstUsedAt !== undefined &&
        delivery.providerConfigurationFingerprint !== args.providerConfigurationFingerprint) {
      await ctx.db.patch(delivery._id, {
        status: "failed", failureReason: "email_provider_configuration_changed",
        autoRetryAt: undefined, updatedAt: now
      });
      await raiseDeliveryException(ctx, delivery, "email_provider_configuration_changed", now);
      return null;
    }

    const attemptCount = delivery.attemptCount + 1;
    await ctx.db.patch(delivery._id, {
      status: "sending",
      attemptCount,
      lastAttemptAt: now,
      failureReason: undefined,
      autoRetryAt: undefined,
      providerKeyFirstUsedAt: delivery.providerKeyFirstUsedAt ?? now,
      ...(args.providerConfigurationFingerprint ? { providerConfigurationFingerprint: args.providerConfigurationFingerprint } : {}),
      updatedAt: now
    });
    return {
      deliveryId: delivery._id,
      ticketCode: delivery.ticketCode,
      bookingRef: delivery.bookingRef,
      emailLower: delivery.emailLower,
      visitDate: booking.visitDate,
      entryTime: booking.entryTime,
      partySize: booking.partySize,
      attemptCount,
      sendVersion: delivery.sendVersion
    };
  }
});

export const recordTicketDeliverySent = internalMutation({
  args: {
    deliveryId: v.id("ticketDeliveries"),
    providerMessageId: v.string(),
    attemptCount: v.number(),
    sendVersion: v.number()
  },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery || delivery.status === "sent") return null;
    if (
      delivery.status !== "sending" ||
      delivery.attemptCount !== args.attemptCount ||
      delivery.sendVersion !== args.sendVersion
    ) {
      return null;
    }
    const now = Date.now();
    await ctx.db.patch(delivery._id, {
      status: "sent",
      providerMessageId: requiredText(args.providerMessageId, "providerMessageId", 200),
      failureReason: undefined,
      autoRetryAt: undefined,
      sentAt: now,
      providerDeliveryStatus: "accepted",
      providerStatusAt: now,
      providerTrackingAt: now + 60_000,
      providerTrackingCount: 0,
      updatedAt: now
    });
    await scheduleDeliveryTracking(ctx, delivery._id, now + 60_000);
    await resolveOperationsException(
      ctx,
      deliveryExceptionKey(delivery, "email_provider_unconfigured"),
      "sent_after_configuration",
      now
    );
    await ctx.db.insert("auditEvents", {
      action: "ticket.deliverySent",
      entityType: "ticketDelivery",
      entityRef: delivery.bookingRef,
      metadata: {
        bookingRef: delivery.bookingRef,
        attemptCount: delivery.attemptCount,
        sendVersion: delivery.sendVersion
      },
      createdAt: now
    });
    return null;
  }
});

export const recordTicketDeliveryFailure = internalMutation({
  args: {
    deliveryId: v.id("ticketDeliveries"),
    failureReason: v.string(),
    attemptCount: v.number(),
    sendVersion: v.number()
  },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery || delivery.status === "sent") return null;
    if (
      delivery.status !== "sending" ||
      delivery.attemptCount !== args.attemptCount ||
      delivery.sendVersion !== args.sendVersion
    ) {
      return null;
    }
    await applyDeliveryFailure(ctx, delivery, requiredText(args.failureReason, "failureReason", 240), Date.now());
    return null;
  }
});

/**
 * Records a failed send and decides, without guessing, whether automation may
 * retry it: only a retryable outcome, with the same key, while the provider
 * still retains that key, a bounded number of times. Everything else becomes
 * a staff-visible exception with no further automatic email.
 */
async function applyDeliveryFailure(ctx: MutationCtx, delivery: DeliveryDoc, failureReason: string, now: number) {
  const retryCount = delivery.autoRetryCount ?? 0;
  const keyAge = delivery.providerKeyFirstUsedAt === undefined ? 0 : now - delivery.providerKeyFirstUsedAt;
  const backoff = deliveryRetryBackoffMs[Math.min(retryCount, deliveryRetryBackoffMs.length - 1)];
  const retryable = retryableFailureReasons.has(failureReason);
  const canRetry = retryable && retryCount < deliveryMaxAutoRetries && keyAge + backoff < deliveryAutoRetryWindowMs;

  await ctx.db.patch(delivery._id, {
    status: "failed",
    failureReason,
    ...(canRetry ? { autoRetryAt: now + backoff, autoRetryCount: retryCount + 1 } : { autoRetryAt: undefined }),
    updatedAt: now
  });
  await ctx.db.insert("auditEvents", {
    action: "ticket.deliveryFailed",
    entityType: "ticketDelivery",
    entityRef: delivery.bookingRef,
    metadata: {
      bookingRef: delivery.bookingRef,
      attemptCount: delivery.attemptCount,
      sendVersion: delivery.sendVersion,
      reason: failureReason,
      autoRetry: canRetry
    },
    createdAt: now
  });
  if (canRetry) {
    await ctx.scheduler.runAfter(backoff, sendTicketConfirmationAction, { deliveryId: delivery._id });
    return;
  }
  await raiseDeliveryException(
    ctx,
    { ...delivery, failureReason },
    retryable ? "email_delivery_unknown_after_idempotency_window" : failureReason,
    now
  );
}

function deliveryExceptionKey(delivery: Pick<DeliveryDoc, "bookingRef" | "sendVersion">, code: string) {
  return `ticket_delivery:${code}:${delivery.bookingRef}:${delivery.sendVersion}`;
}

async function raiseDeliveryException(ctx: MutationCtx, delivery: DeliveryDoc, code: string, now: number) {
  if (code === "email_delivery_unknown_after_idempotency_window") {
    await ctx.db.patch(delivery._id, { status: "failed", failureReason: code, autoRetryAt: undefined, updatedAt: now });
  }
  await openOperationsException(ctx, {
    category: "ticket_delivery",
    code,
    dedupeKey: deliveryExceptionKey(delivery, code),
    moneyReceived: false,
    orderRef: delivery.orderRef,
    saleRef: delivery.saleRef,
    bookingRef: delivery.bookingRef,
    evidence: {
      sendVersion: delivery.sendVersion,
      attemptCount: delivery.attemptCount,
      autoRetryCount: delivery.autoRetryCount,
      lastFailureReason: delivery.failureReason
    },
    now
  });
}

async function deliveryPaymentBlocker(
  ctx: MutationCtx,
  delivery: DeliveryDoc,
  booking: Doc<"bookings">
): Promise<string | null> {
  if (booking.status !== "confirmed" && booking.status !== "checked-in") return "booking_not_confirmed";
  if (delivery.orderRef) {
    if ((await openBillingExceptionsForOrder(ctx, delivery.orderRef)).length > 0) return "billing_exception_unresolved";
    const order = await ctx.db
      .query("orders")
      .withIndex("by_orderRef", (q) => q.eq("orderRef", delivery.orderRef!))
      .unique();
    return order?.status === "paid" ? null : "order_not_paid";
  }
  if (delivery.saleRef) {
    const sale = await ctx.db
      .query("posSales")
      .withIndex("by_saleRef", (q) => q.eq("saleRef", delivery.saleRef!))
      .unique();
    return sale?.status === "paid" ? null : "sale_not_paid";
  }
  return "payment_reference_missing";
}

/**
 * Missing email configuration is recorded before any provider request, so it
 * never consumes the idempotency window. Retries are bounded and backed off,
 * and the gap is visible to staff immediately.
 */
export const recordTicketDeliveryUnconfigured = internalMutation({
  args: { deliveryId: v.id("ticketDeliveries"), reason: v.string() },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery || delivery.status === "sent" || delivery.status === "suppressed") return null;
    const now = Date.now();
    if (delivery.status === "sending" && delivery.lastAttemptAt !== undefined && now - delivery.lastAttemptAt < sendingLeaseMs) {
      return null;
    }
    if (delivery.status === "failed" && delivery.autoRetryAt !== undefined && delivery.autoRetryAt > now) {
      return null;
    }
    await raiseDeliveryException(ctx, delivery, "email_provider_unconfigured", now);
    if (delivery.status === "sending") {
      // A stale sending lease keeps its outcome-unknown meaning for its key.
      await applyDeliveryFailure(ctx, delivery, "email_delivery_outcome_unknown", now);
      return null;
    }
    const retryCount = delivery.autoRetryCount ?? 0;
    const backoff = deliveryRetryBackoffMs[Math.min(retryCount + 3, deliveryRetryBackoffMs.length - 1)];
    const canRetry = retryCount < deliveryMaxAutoRetries;
    await ctx.db.patch(delivery._id, {
      status: "failed",
      failureReason: "email_provider_unconfigured",
      ...(canRetry ? { autoRetryAt: now + backoff, autoRetryCount: retryCount + 1 } : { autoRetryAt: undefined }),
      updatedAt: now
    });
    await ctx.db.insert("auditEvents", {
      action: "ticket.deliveryFailed",
      entityType: "ticketDelivery",
      entityRef: delivery.bookingRef,
      metadata: {
        bookingRef: delivery.bookingRef,
        sendVersion: delivery.sendVersion,
        reason: "email_provider_unconfigured",
        detail: args.reason.slice(0, 120),
        autoRetry: canRetry
      },
      createdAt: now
    });
    if (canRetry) {
      await ctx.scheduler.runAfter(backoff, sendTicketConfirmationAction, { deliveryId: delivery._id });
    }
    return null;
  }
});

/**
 * Bounded cron repair for deliveries whose scheduled send was lost, whose
 * sending lease went stale, or whose automatic retry came due.
 */
export const sweepTicketDeliveries = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number; recovered: number }> => {
    const now = Date.now();
    const [queued, stale, due] = await Promise.all([
      ctx.db
        .query("ticketDeliveries")
        .withIndex("by_status_updatedAt", (q) => q.eq("status", "queued").lt("updatedAt", now - queuedDeliveryGraceMs))
        .take(sweepBatchSize),
      ctx.db
        .query("ticketDeliveries")
        .withIndex("by_status_updatedAt", (q) => q.eq("status", "sending").lt("updatedAt", now - sendingLeaseMs))
        .take(sweepBatchSize),
      ctx.db
        .query("ticketDeliveries")
        .withIndex("by_autoRetryAt", (q) => q.gte("autoRetryAt", 0).lte("autoRetryAt", now))
        .take(sweepBatchSize)
    ]);
    let scheduled = 0;
    for (const delivery of [...queued, ...due]) {
      await ctx.scheduler.runAfter(0, sendTicketConfirmationAction, { deliveryId: delivery._id });
      scheduled += 1;
    }
    // A sending lease that expired without a recorded result is an unknown
    // provider outcome for that key, never a fresh send.
    for (const delivery of stale) {
      await applyDeliveryFailure(ctx, delivery, "email_delivery_outcome_unknown", now);
    }
    return { scheduled, recovered: stale.length };
  }
});

export const sendTicketConfirmation = internalAction({
  args: { deliveryId: v.id("ticketDeliveries") },
  handler: async (ctx, args) => {
    // Configuration is checked before the claim, so a missing sender never
    // starts the provider idempotency window or looks like an unknown send.
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.SKYLA_TICKET_FROM_EMAIL?.trim();
    let origin: string;
    try {
      if (!apiKey || !from) throw new Error("RESEND_API_KEY and SKYLA_TICKET_FROM_EMAIL must be configured");
      origin = normalizedPublicOrigin(process.env.SKYLA_PUBLIC_ORIGIN);
    } catch (error) {
      await ctx.runMutation(recordDeliveryUnconfiguredMutation, {
        deliveryId: args.deliveryId,
        reason: error instanceof Error ? error.message : "email_provider_unconfigured"
      });
      return null;
    }

    const replyTo = process.env.SKYLA_TICKET_REPLY_TO?.trim() || "reservations@skydeckla.com";
    const payload = await ctx.runMutation(claimDeliveryMutation, {
      ...args, providerConfigurationFingerprint: await providerConfigurationFingerprint(["resend", apiKey!, from!, origin, replyTo])
    });
    if (!payload) return null;

    const recordFailure = async (failureReason: string) => {
      await ctx.runMutation(recordDeliveryFailureMutation, {
        deliveryId: payload.deliveryId,
        failureReason,
        attemptCount: payload.attemptCount,
        sendVersion: payload.sendVersion
      });
    };

    try {
      const ticketUrl = `${origin}/tickets/${encodeURIComponent(payload.ticketCode)}`;
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `skyla-ticket/${payload.ticketCode}/${payload.sendVersion}`,
          "User-Agent": "skyla-ticket-delivery/1.0"
        },
        body: JSON.stringify({
          from,
          to: [payload.emailLower],
          reply_to: replyTo,
          subject: `Your Sky LA ticket - ${payload.bookingRef}`,
          html: ticketEmailHtml(payload, ticketUrl)
        }),
        signal: AbortSignal.timeout(20_000)
      });
      const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
      if (!response.ok) {
        // 409 (key in flight or reused), 5xx and unreadable answers may hide
        // an accepted email; 429 was not processed. Other 4xx are permanent
        // (bad sender, recipient or key) and need a person, not a retry.
        const outcomeMayBeUnknown = response.status === 409 || response.status >= 500;
        await recordFailure(
          outcomeMayBeUnknown
            ? "email_delivery_outcome_unknown"
            : `email_provider_${response.status}`
        );
        return null;
      }
      if (typeof body?.id !== "string" || !body.id.trim()) {
        await recordFailure("email_delivery_outcome_unknown");
        return null;
      }
      await ctx.runMutation(recordDeliverySentMutation, {
        deliveryId: payload.deliveryId,
        providerMessageId: body.id,
        attemptCount: payload.attemptCount,
        sendVersion: payload.sendVersion
      });
      return null;
    } catch {
      // The provider may have accepted the request before the connection failed.
      // Preserve the send version so a retry reuses Resend's idempotency key.
      await recordFailure("email_delivery_outcome_unknown");
      return null;
    }
  }
});

export const getTicketDeliveryInternal = internalQuery({
  args: { deliveryId: v.id("ticketDeliveries") },
  handler: async (ctx, args) => ctx.db.get(args.deliveryId)
});

function projectStaffDelivery(delivery: DeliveryDoc) {
  return {
    bookingRef: delivery.bookingRef,
    ticketCode: delivery.ticketCode,
    status: delivery.status,
    attemptCount: delivery.attemptCount,
    sendVersion: delivery.sendVersion,
    lastAttemptAt: delivery.lastAttemptAt,
    sentAt: delivery.sentAt,
    providerDeliveryStatus: delivery.providerDeliveryStatus,
    providerStatusAt: delivery.providerStatusAt,
    deliveredAt: delivery.deliveredAt,
    failureReason: delivery.failureReason,
    updatedAt: delivery.updatedAt
  };
}

function normalizedPublicOrigin(value: string | undefined) {
  const candidate = value?.trim();
  if (!candidate) throw new Error("SKYLA_PUBLIC_ORIGIN must be configured");
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("SKYLA_PUBLIC_ORIGIN must be an HTTPS origin");
  }
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("SKYLA_PUBLIC_ORIGIN must be an HTTPS origin");
  }
  return url.origin;
}

function requiredText(value: string, label: string, maxLength: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${label} must be between 1 and ${maxLength} characters`);
  }
  return normalized;
}

function ticketEmailHtml(payload: DeliveryPayload, ticketUrl: string) {
  const details = [
    payload.visitDate ? `<li>Visit date: ${escapeHtml(payload.visitDate)}</li>` : "",
    payload.entryTime ? `<li>Entry time: ${escapeHtml(payload.entryTime)}</li>` : "",
    payload.partySize ? `<li>Guests: ${payload.partySize}</li>` : ""
  ].join("");
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111"><h1>Sky LA ticket</h1><p>Payment confirmed. Keep this ticket for check-in.</p><p>Valid on the selected Los Angeles date, from your entry time until closing. One admission for the booked party. No re-entry.</p><ul><li>Booking: ${escapeHtml(payload.bookingRef)}</li>${details}</ul><p><a href="${escapeHtml(ticketUrl)}">Open your ticket</a></p><p><img src="${escapeHtml(`${ticketUrl}/qr`)}" width="240" height="240" alt="Check-in QR code"></p><p>Questions? Reply to this email or contact reservations@skydeckla.com.</p></body></html>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character] ?? character);
}
