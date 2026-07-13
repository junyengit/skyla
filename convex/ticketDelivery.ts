import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query
} from "./_generated/server";
import { requireStaffUser } from "./lib/auth";
import { normalizeTicketCode } from "./lib/ticketDelivery";

declare const process: { env: Record<string, string | undefined> };

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
  { deliveryId: Id<"ticketDeliveries"> },
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

    return {
      ticketCode: delivery.ticketCode,
      bookingRef: booking.bookingRef,
      status: booking.status,
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
    // unknown provider outcome without risking a second customer email.
    const recoveringStaleSend = delivery.status === "sending";
    const recoveringUnknownOutcome =
      delivery.status === "failed" && delivery.failureReason === "email_delivery_outcome_unknown";
    const recoveringExistingAttempt = recoveringStaleSend || recoveringUnknownOutcome;
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
          : {})
      },
      createdAt: now
    });
    await ctx.scheduler.runAfter(0, sendTicketConfirmationAction, { deliveryId: delivery._id });
    return projectStaffDelivery(queuedDelivery);
  }
});

export const claimTicketDelivery = internalMutation({
  args: { deliveryId: v.id("ticketDeliveries") },
  handler: async (ctx, args): Promise<DeliveryPayload | null> => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery || delivery.status === "sent") return null;
    const now = Date.now();
    if (
      delivery.status === "sending" &&
      delivery.lastAttemptAt !== undefined &&
      now - delivery.lastAttemptAt < sendingLeaseMs
    ) {
      return null;
    }
    if (!delivery.emailLower) {
      await ctx.db.patch(delivery._id, {
        status: "suppressed",
        failureReason: "customer_email_missing",
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
        updatedAt: now
      });
      return null;
    }
    if (booking.status === "cancelled") {
      await ctx.db.patch(delivery._id, {
        status: "suppressed",
        failureReason: "booking_cancelled",
        updatedAt: now
      });
      return null;
    }

    const attemptCount = delivery.attemptCount + 1;
    await ctx.db.patch(delivery._id, {
      status: "sending",
      attemptCount,
      lastAttemptAt: now,
      failureReason: undefined,
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
      sentAt: now,
      updatedAt: now
    });
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
    const now = Date.now();
    await ctx.db.patch(delivery._id, {
      status: "failed",
      failureReason: requiredText(args.failureReason, "failureReason", 240),
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
        reason: requiredText(args.failureReason, "failureReason", 240)
      },
      createdAt: now
    });
    return null;
  }
});

export const sendTicketConfirmation = internalAction({
  args: { deliveryId: v.id("ticketDeliveries") },
  handler: async (ctx, args) => {
    const payload = await ctx.runMutation(claimDeliveryMutation, args);
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
      const apiKey = process.env.RESEND_API_KEY?.trim();
      const from = process.env.SKYLA_TICKET_FROM_EMAIL?.trim();
      if (!apiKey || !from) {
        await recordFailure("email_provider_unconfigured");
        return null;
      }

      const origin = normalizedPublicOrigin(process.env.SKYLA_PUBLIC_ORIGIN);
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
          reply_to: process.env.SKYLA_TICKET_REPLY_TO?.trim() || "reservations@skydeckla.com",
          subject: `Your Sky LA ticket - ${payload.bookingRef}`,
          html: ticketEmailHtml(payload, ticketUrl)
        })
      });
      const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
      if (!response.ok) {
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

function projectStaffDelivery(delivery: {
  bookingRef: string;
  ticketCode: string;
  status: "queued" | "sending" | "sent" | "failed" | "suppressed";
  attemptCount: number;
  sendVersion: number;
  providerMessageId?: string;
  lastAttemptAt?: number;
  sentAt?: number;
  failureReason?: string;
  updatedAt: number;
}) {
  return {
    bookingRef: delivery.bookingRef,
    ticketCode: delivery.ticketCode,
    status: delivery.status,
    attemptCount: delivery.attemptCount,
    sendVersion: delivery.sendVersion,
    lastAttemptAt: delivery.lastAttemptAt,
    sentAt: delivery.sentAt,
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
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111"><h1>Sky LA ticket</h1><p>Payment confirmed. Keep this ticket for check-in.</p><ul><li>Booking: ${escapeHtml(payload.bookingRef)}</li>${details}</ul><p><a href="${escapeHtml(ticketUrl)}">Open your ticket</a></p><p><img src="${escapeHtml(`${ticketUrl}/qr`)}" width="240" height="240" alt="Check-in QR code"></p><p>Questions? Reply to this email or contact reservations@skydeckla.com.</p></body></html>`;
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
