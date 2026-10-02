import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, type MutationCtx } from "./_generated/server";
import { openOperationsException, resolveOperationsException } from "./lib/operationsExceptions";
import { scheduleDeliveryTracking } from "./lib/ticketDeliveryTracking";

declare const process: { env: Record<string, string | undefined> };
const trackingWindowMs = 7 * 24 * 60 * 60 * 1000;
const maxReads = 30;
const leaseMs = 2 * 60 * 1000;
const backoff = [1, 5, 15, 60, 360, 720].map((minutes) => minutes * 60 * 1000);
const events = new Set(["bounced", "canceled", "clicked", "complained", "delivered", "delivery_delayed",
  "failed", "opened", "queued", "scheduled", "sent", "suppressed"]);
const deliveredEvents = new Set(["delivered", "opened", "clicked"]);
const terminalFailures = new Set(["bounced", "complained", "failed", "suppressed", "canceled"]);
type Delivery = Doc<"ticketDeliveries">;
type TrackingClaim = { messageId: string; emailLower: string; sendVersion: number; leaseToken: string };

async function flagTracking(ctx: MutationCtx, delivery: Delivery, code: string, now: number) {
  await openOperationsException(ctx, {
    category: "ticket_delivery", code,
    dedupeKey: `email_tracking:${code}:${delivery.bookingRef}:${delivery.sendVersion}`,
    moneyReceived: false, orderRef: delivery.orderRef, saleRef: delivery.saleRef, bookingRef: delivery.bookingRef,
    evidence: { sendVersion: delivery.sendVersion, providerDeliveryStatus: delivery.providerDeliveryStatus,
      providerTrackingCount: delivery.providerTrackingCount }, now
  });
}

export const claimTicketDeliveryTracking = internalMutation({
  args: { deliveryId: v.id("ticketDeliveries"), leaseToken: v.string() },
  handler: async (ctx, args): Promise<TrackingClaim | null> => {
    const delivery = await ctx.db.get(args.deliveryId);
    const now = Date.now();
    if (!delivery || delivery.status !== "sent" || !delivery.providerMessageId || !delivery.emailLower ||
        delivery.providerTrackingAt === undefined || delivery.providerTrackingAt > now ||
        (delivery.providerTrackingLeaseExpiresAt ?? 0) > now) return null;
    if ((delivery.providerTrackingCount ?? 0) >= maxReads || now - (delivery.sentAt ?? delivery.updatedAt) >= trackingWindowMs) {
      await ctx.db.patch(delivery._id, { providerTrackingAt: undefined, providerTrackingLease: undefined,
        providerTrackingLeaseExpiresAt: undefined });
      if (!delivery.deliveredAt) await flagTracking(ctx, delivery, "email_delivery_tracking_unconfirmed", now);
      return null;
    }
    await ctx.db.patch(delivery._id, {
      providerTrackingCount: (delivery.providerTrackingCount ?? 0) + 1,
      providerTrackingLease: args.leaseToken, providerTrackingLeaseExpiresAt: now + leaseMs,
      providerTrackingAt: now + leaseMs
    });
    return { messageId: delivery.providerMessageId, emailLower: delivery.emailLower,
      sendVersion: delivery.sendVersion, leaseToken: args.leaseToken };
  }
});

export const recordTicketDeliveryTracking = internalMutation({
  args: { deliveryId: v.id("ticketDeliveries"), leaseToken: v.string(), sendVersion: v.number(),
    messageId: v.string(), event: v.optional(v.string()), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery || delivery.status !== "sent" || delivery.sendVersion !== args.sendVersion ||
        delivery.providerMessageId !== args.messageId || delivery.providerTrackingLease !== args.leaseToken) return { applied: false };
    const now = Date.now();
    const event = args.event && events.has(args.event) ? args.event : undefined;
    const error = args.error ?? (!event ? "email_tracking_response_invalid" : undefined);
    const positive = event && deliveredEvents.has(event);
    const terminal = event && terminalFailures.has(event);
    const deliveredAt = delivery.deliveredAt ?? (positive ? now : undefined);
    const exhausted = (delivery.providerTrackingCount ?? 0) >= maxReads || now - (delivery.sentAt ?? now) >= trackingWindowMs;
    const at = terminal || exhausted ? undefined : Math.min(
      now + (deliveredAt ? 24 * 60 * 60 * 1000 : backoff[Math.min((delivery.providerTrackingCount ?? 1) - 1, backoff.length - 1)]),
      (delivery.sentAt ?? now) + trackingWindowMs
    );
    await ctx.db.patch(delivery._id, {
      ...(event ? { providerDeliveryStatus: event, providerStatusAt: now } : {}),
      ...(deliveredAt ? { deliveredAt } : {}), providerTrackingAt: at,
      providerTrackingLease: undefined, providerTrackingLeaseExpiresAt: undefined, updatedAt: now
    });
    if (terminal) await flagTracking(ctx, { ...delivery, providerDeliveryStatus: event }, `email_${event}`, now);
    if (error) await flagTracking(ctx, delivery, error, now);
    if (exhausted && !deliveredAt) await flagTracking(ctx, delivery, "email_delivery_tracking_unconfirmed", now);
    if (positive) {
      for (const code of ["email_tracking_unconfigured", "email_tracking_unavailable", "email_tracking_response_invalid",
        "email_delivery_tracking_unconfirmed"]) {
        await resolveOperationsException(ctx, `email_tracking:${code}:${delivery.bookingRef}:${delivery.sendVersion}`, "provider_delivery_confirmed", now);
      }
    }
    if (at !== undefined) await scheduleDeliveryTracking(ctx, delivery._id, at);
    return { applied: true };
  }
});

export const trackTicketDelivery = internalAction({
  args: { deliveryId: v.id("ticketDeliveries") },
  handler: async (ctx, args): Promise<null> => {
    const claim = await ctx.runMutation(makeFunctionReference<"mutation",
      { deliveryId: Id<"ticketDeliveries">; leaseToken: string }, TrackingClaim | null>(
      "ticketDeliveryTracking:claimTicketDeliveryTracking"), { ...args, leaseToken: crypto.randomUUID() });
    if (!claim) return null;
    const record = (outcome: { event?: string; error?: string }) => ctx.runMutation(makeFunctionReference<"mutation",
      { deliveryId: Id<"ticketDeliveries">; leaseToken: string; sendVersion: number; messageId: string; event?: string; error?: string },
      { applied: boolean }>("ticketDeliveryTracking:recordTicketDeliveryTracking"), {
      deliveryId: args.deliveryId, leaseToken: claim.leaseToken, sendVersion: claim.sendVersion,
      messageId: claim.messageId, ...outcome
    });
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) { await record({ error: "email_tracking_unconfigured" }); return null; }
    try {
      const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(claim.messageId)}`, {
        headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20_000)
      });
      if (!response.ok) {
        await record({ error: response.status === 401 || response.status === 403 ? "email_tracking_unconfigured" : "email_tracking_unavailable" });
        return null;
      }
      const result = await response.json() as { object?: unknown; id?: unknown; to?: unknown; last_event?: unknown };
      if (!result || result.object !== "email" || result.id !== claim.messageId || !Array.isArray(result.to) || result.to.length !== 1 ||
          typeof result.to[0] !== "string" || result.to[0].toLowerCase() !== claim.emailLower ||
          typeof result.last_event !== "string" || !events.has(result.last_event)) {
        await record({ error: "email_tracking_response_invalid" }); return null;
      }
      await record({ event: result.last_event });
    } catch { await record({ error: "email_tracking_unavailable" }); }
    return null;
  }
});

export const sweepTicketDeliveryTracking = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db.query("ticketDeliveries").withIndex("by_providerTrackingAt",
      (q) => q.gte("providerTrackingAt", 0).lte("providerTrackingAt", now)).take(25);
    let scheduled = 0;
    for (const delivery of due) {
      if ((delivery.providerTrackingLeaseExpiresAt ?? 0) > now) continue;
      await scheduleDeliveryTracking(ctx, delivery._id, now); scheduled += 1;
    }
    return { scheduled };
  }
});
