import { parseVisitDate, venueToday } from "@skyla/payments";
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireStaffUser } from "./lib/auth";
import {
  loadDateOccupancy,
  loadVenueHours,
  occupiedPlaces
} from "./lib/capacity";
import {
  normalizeCancelReason,
  normalizePrivateEventInput,
  privateEventFingerprint,
  privateEventListLimit,
  privateEventRefFromId
} from "./lib/privateEvents";

function privateEventResult(event: Doc<"privateEvents">) {
  return {
    eventRef: event.eventRef,
    visitDate: event.visitDate,
    status: event.status,
    label: event.label,
    ...(event.notes ? { notes: event.notes } : {}),
    createdAt: event.createdAt,
    ...(event.cancelledAt !== undefined
      ? { cancelledAt: event.cancelledAt, cancelReason: event.cancelReason }
      : {})
  };
}

/** Staff calendar read: admins and viewers, read-only for viewers. */
export const listPrivateEvents = query({
  args: {
    fromDate: v.optional(v.string()),
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    await requireStaffUser(ctx, ["admin", "viewer"]);
    const fromDate = args.fromDate === undefined ? venueToday(Date.now()) : parseVisitDate(args.fromDate);
    if (!fromDate) {
      throw new Error("fromDate must be a real YYYY-MM-DD date");
    }
    const limit = args.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > privateEventListLimit) {
      throw new Error(`limit must be a whole number from 1 to ${privateEventListLimit}`);
    }
    const events = await ctx.db
      .query("privateEvents")
      .withIndex("by_visitDate_status", (q) => q.gte("visitDate", fromDate))
      .take(limit);
    return { fromDate, events: events.map(privateEventResult) };
  }
});

/**
 * Records a confirmed private event for a whole LA date. Rejected when the
 * date already has a confirmed event, held or committed visitor places, or
 * visit records that cannot be verified for that date. Idempotent per key.
 */
export const createPrivateEvent = mutation({
  args: {
    visitDate: v.string(),
    label: v.string(),
    notes: v.optional(v.string()),
    idempotencyKey: v.string()
  },
  handler: async (ctx, args) => {
    const staffUser = await requireStaffUser(ctx, ["admin"]);
    const now = Date.now();
    const input = normalizePrivateEventInput(args, now);
    const requestFingerprint = privateEventFingerprint(input);

    const existing = await ctx.db
      .query("privateEvents")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", input.idempotencyKey))
      .first();
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new Error("idempotencyKey was already used for a different private event");
      }
      return { event: privateEventResult(existing), reused: true };
    }

    const hours = await loadVenueHours(ctx);
    const occupancy = await loadDateOccupancy(ctx, input.visitDate, hours);
    if (occupancy.privateEvent) {
      throw new Error("Private event conflicts with an existing confirmed private event on that date");
    }
    const places = occupiedPlaces(occupancy);
    if (places > 0) {
      throw new Error(
        `Private event conflicts with ${places} held or committed visitor place${places === 1 ? "" : "s"} on that date`
      );
    }
    // Unknown imported bookings may occupy this date too. Confirmation must
    // wait for reconciliation rather than treating uncertainty as free space.
    if (occupancy.unverifiedReason) {
      throw new Error("Private event conflicts with visit records that cannot be verified for that date");
    }

    const eventId = await ctx.db.insert("privateEvents", {
      eventRef: "pending",
      visitDate: input.visitDate,
      status: "confirmed",
      label: input.label,
      ...(input.notes ? { notes: input.notes } : {}),
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      createdBy: staffUser._id,
      createdAt: now,
      updatedAt: now
    });
    const eventRef = privateEventRefFromId(eventId, input.visitDate);
    await ctx.db.patch(eventId, { eventRef });
    await ctx.db.insert("auditEvents", {
      actorStaffUserId: staffUser._id,
      action: "privateEvent.create",
      entityType: "privateEvent",
      entityRef: eventRef,
      metadata: { visitDate: input.visitDate, status: "confirmed" },
      createdAt: now
    });

    const event = await ctx.db.get(eventId);
    return { event: privateEventResult(event!), reused: false };
  }
});

/**
 * Cancels a confirmed private event, keeping the record and its history.
 * There is no reactivation: a new event must pass the conflict checks again.
 */
export const cancelPrivateEvent = mutation({
  args: {
    eventRef: v.string(),
    reason: v.string()
  },
  handler: async (ctx, args) => {
    const staffUser = await requireStaffUser(ctx, ["admin"]);
    const reason = normalizeCancelReason(args.reason);
    const event = await ctx.db
      .query("privateEvents")
      .withIndex("by_eventRef", (q) => q.eq("eventRef", args.eventRef.trim()))
      .unique();
    if (!event) {
      throw new Error("Private event was not found");
    }
    if (event.status === "cancelled") {
      return { event: privateEventResult(event), reused: true };
    }

    const now = Date.now();
    await ctx.db.patch(event._id, {
      status: "cancelled",
      cancelledAt: now,
      cancelledBy: staffUser._id,
      cancelReason: reason,
      updatedAt: now
    });
    await ctx.db.insert("auditEvents", {
      actorStaffUserId: staffUser._id,
      action: "privateEvent.cancel",
      entityType: "privateEvent",
      entityRef: event.eventRef,
      metadata: { visitDate: event.visitDate, previousStatus: "confirmed", status: "cancelled", reason },
      createdAt: now
    });
    return {
      event: privateEventResult({ ...event, status: "cancelled", cancelledAt: now, cancelReason: reason }),
      reused: false
    };
  }
});
