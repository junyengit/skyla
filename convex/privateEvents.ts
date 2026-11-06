import { parseVisitDate, venueToday } from "@skyla/payments";
import { ConvexError, v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireStaffUser } from "./lib/auth";
import {
  loadDateOccupancy,
  loadVenueHours,
  occupiedPlaces
} from "./lib/capacity";
import {
  assertNewPrivateEventDate,
  decodePrivateEventCursor,
  encodePrivateEventCursor,
  normalizeCancelReason,
  normalizePrivateEventRange,
  normalizePrivateEventRef,
  normalizePrivateEventRequest,
  privateEventBytesRead,
  privateEventCancelFingerprint,
  privateEventFingerprint,
  privateEventListLimit,
  privateEventPageSize,
  privateEventRefFromId,
  privateEventRowsRead
} from "./lib/privateEvents";
import { normalizeIdempotencyKey } from "./lib/orderDraftPersistence";

/** Neither recoverable alias may identify a different or second record. */
async function assertPrivateEventIdentity(ctx: QueryCtx | MutationCtx, event: Doc<"privateEvents">) {
  if (normalizeIdempotencyKey(event.idempotencyKey) !== event.idempotencyKey ||
      normalizePrivateEventRef(event.eventRef) !== event.eventRef) {
    throw new Error("Private event operation identity needs reconciliation");
  }
  const [keys, refs] = await Promise.all([
    ctx.db.query("privateEvents").withIndex("by_idempotencyKey", q => q.eq("idempotencyKey", event.idempotencyKey)).take(2),
    ctx.db.query("privateEvents").withIndex("by_eventRef", q => q.eq("eventRef", event.eventRef)).take(2)
  ]);
  if (keys.length !== 1 || refs.length !== 1 || keys[0]._id !== event._id || refs[0]._id !== event._id) {
    throw new Error("Private event operation identity is ambiguous");
  }
}

function privateEventResult(event: Doc<"privateEvents">) {
  const normalized = normalizePrivateEventRequest(event);
  if (normalizePrivateEventRef(event.eventRef) !== event.eventRef ||
      event.eventRef.slice(3, 11) !== event.visitDate.replaceAll("-", "")) {
    throw new Error("Private event reference date needs reconciliation");
  }
  if (!Number.isSafeInteger(event.createdAt) || event.createdAt < 0 ||
      normalized.label !== event.label || normalized.notes !== event.notes ||
      normalized.sourceRef !== event.sourceRef || normalized.confirmationSource !== event.confirmationSource) {
    throw new Error("Private event record needs reconciliation");
  }
  if (event.status === "cancelled") {
    if (!Number.isSafeInteger(event.cancelledAt) || event.cancelledAt! < event.createdAt ||
        normalizeCancelReason(event.cancelReason) !== event.cancelReason) {
      throw new Error("Private event cancellation needs reconciliation");
    }
  } else if (event.status !== "confirmed" || event.cancelledAt !== undefined || event.cancelReason !== undefined || event.cancelledBy !== undefined) {
    throw new Error("Private event status needs reconciliation");
  }
  return {
    eventRef: event.eventRef,
    visitDate: event.visitDate,
    status: event.status,
    label: event.label,
    ...(event.notes ? { notes: event.notes } : {}),
    ...(event.confirmationSource ? { confirmationSource: event.confirmationSource, sourceRef: event.sourceRef } : {}),
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

/** Native pagination with an immutable date index and fixed creation membership. */
export const listPrivateEventsRange = query({
  args: {
    from: v.string(), to: v.string(),
    cursor: v.optional(v.union(v.string(), v.null())),
    endCursor: v.optional(v.union(v.string(), v.null()))
  },
  handler: async (ctx, args) => {
    const staff = await requireStaffUser(ctx, ["admin", "viewer"]);
    const role = staff.role === "admin" ? "admin" as const : "viewer" as const;
    const range = normalizePrivateEventRange(args.from, args.to);
    const now = Date.now();
    const start = args.cursor === undefined || args.cursor === null ? null : decodePrivateEventCursor(args.cursor, range, now);
    const end = args.endCursor === undefined || args.endCursor === null ? null : decodePrivateEventCursor(args.endCursor, range, now);
    if (start && end && start.cutoff !== end.cutoff) throw new Error("Calendar cursors have different cutoffs");
    const cutoff = start?.cutoff ?? end?.cutoff ?? now;
    const endCursor = args.endCursor ?? null;
    if (start && end && start.native === end.native) {
      return { role, range, cutoff, events: [], continueCursor: null, isDone: false, pageStatus: null, splitCursor: null, endCursor, segmentDone: true };
    }
    const result = await ctx.db.query("privateEvents")
      .withIndex("by_visitDate", q => q.gte("visitDate", range.from).lte("visitDate", range.to))
      .filter(q => q.lte(q.field("_creationTime"), cutoff))
      .order("asc")
      .paginate({
        numItems: privateEventPageSize, cursor: start?.native ?? null,
        ...(end ? { endCursor: end.native } : {}),
        maximumRowsRead: privateEventRowsRead, maximumBytesRead: privateEventBytesRead
      });
    const pageStatus = result.pageStatus ?? null;
    if (pageStatus !== null && pageStatus !== "SplitRecommended" && pageStatus !== "SplitRequired") {
      throw new Error("Calendar pagination status needs reconciliation");
    }
    if (pageStatus && (!result.splitCursor || result.splitCursor === start?.native || result.splitCursor === result.continueCursor)) {
      throw new Error("Calendar page cannot be safely split; refresh or narrow the range");
    }
    const segmentDone = !pageStatus && (end ? result.continueCursor === end.native || result.isDone : result.isDone);
    const isDone = !end && segmentDone;
    if (!segmentDone && result.continueCursor === start?.native) throw new Error("Calendar pagination did not advance");
    // Native split pages may be incomplete. Clients discard this page and
    // replace (start,continue] with (start,split] + (split,continue]. Only an
    // unbounded, unsplit end proves complete range coverage.
    const events = result.page.map(privateEventResult);
    for (const event of result.page) {
      if (event.createdAt > cutoff) throw new Error("Private event creation facts exceed the calendar cutoff");
      await assertPrivateEventIdentity(ctx, event);
    }
    return {
      role, range, cutoff, events,
      continueCursor: segmentDone ? null : encodePrivateEventCursor(range, cutoff, result.continueCursor),
      isDone, pageStatus,
      splitCursor: pageStatus && result.splitCursor ? encodePrivateEventCursor(range, cutoff, result.splitCursor) : null,
      endCursor, segmentDone
    };
  }
});

/** Exact operation recovery; missing record is not proof an in-flight write failed. */
export const getPrivateEventOperation = query({
  args: { idempotencyKey: v.optional(v.string()), eventRef: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const staff = await requireStaffUser(ctx, ["admin", "viewer"]);
    if ((args.idempotencyKey === undefined) === (args.eventRef === undefined)) throw new Error("Specify exactly one private event operation identity");
    const key = args.idempotencyKey === undefined ? undefined : normalizeIdempotencyKey(args.idempotencyKey);
    const eventRef = args.eventRef === undefined ? undefined : normalizePrivateEventRef(args.eventRef);
    const rows = key !== undefined
      ? await ctx.db.query("privateEvents").withIndex("by_idempotencyKey", q => q.eq("idempotencyKey", key)).take(2)
      : await ctx.db.query("privateEvents").withIndex("by_eventRef", q => q.eq("eventRef", eventRef!)).take(2);
    if (rows.length > 1) throw new Error("Private event operation identity is ambiguous");
    if (rows[0]) await assertPrivateEventIdentity(ctx, rows[0]);
    return {
      role: staff.role === "admin" ? "admin" as const : "viewer" as const,
      lookup: key !== undefined ? { key } : { eventRef: eventRef! },
      event: rows[0] ? privateEventResult(rows[0]) : null
    };
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
    // Optional at validation only for exact recovery of original v1 requests.
    confirmationSource: v.optional(v.string()),
    sourceRef: v.optional(v.string()),
    idempotencyKey: v.string()
  },
  handler: async (ctx, args) => {
    const input = normalizePrivateEventRequest(args);
    const requestFingerprint = privateEventFingerprint(input);
    try {
      const staffUser = await requireStaffUser(ctx, ["admin"]);
      const now = Date.now();

      const existing = await ctx.db
        .query("privateEvents")
        .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", input.idempotencyKey))
        .take(2);
      if (existing.length > 1) throw new Error("Private event operation identity is ambiguous");
      if (existing[0]) {
        if (existing[0].requestFingerprint !== requestFingerprint ||
            privateEventFingerprint(normalizePrivateEventRequest(existing[0])) !== existing[0].requestFingerprint) {
          throw new Error("idempotencyKey was already used for a different private event");
        }
        await assertPrivateEventIdentity(ctx, existing[0]);
        return { role: "admin" as const, event: privateEventResult(existing[0]), reused: true };
      }
      if (!input.confirmationSource || !input.sourceRef) throw new Error("confirmationSource and sourceRef are required for a new private event");
      assertNewPrivateEventDate(input.visitDate, now);

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
        confirmationSource: input.confirmationSource,
        sourceRef: input.sourceRef,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint,
        createdBy: staffUser._id,
        createdAt: now,
        updatedAt: now
      });
      const eventRef = privateEventRefFromId(eventId, input.visitDate);
      const refCollisions = await ctx.db.query("privateEvents").withIndex("by_eventRef", q => q.eq("eventRef", eventRef)).take(2);
      if (refCollisions.length > 0) throw new Error("Generated private event reference is ambiguous");
      await ctx.db.patch(eventId, { eventRef });
      await ctx.db.insert("auditEvents", {
        actorStaffUserId: staffUser._id,
        action: "privateEvent.create",
        entityType: "privateEvent",
        entityRef: eventRef,
        metadata: { visitDate: input.visitDate, status: "confirmed", confirmationSource: input.confirmationSource, sourceRef: input.sourceRef },
        createdAt: now
      });

      const event = await ctx.db.get(eventId);
      return { role: "admin" as const, event: privateEventResult(event!), reused: false };
    } catch (error) {
      // Throwing from this database-only mutation rolls back every write. The
      // exact identity lets the route distinguish rollback from transport loss.
      throw new ConvexError({ kind: "private_event_rejected", version: 1, operation: "create",
        lookup: { key: input.idempotencyKey }, requestFingerprint,
        message: error instanceof Error ? error.message.slice(0, 500) : "Private event could not be recorded" });
    }
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
    const reason = normalizeCancelReason(args.reason);
    const eventRef = normalizePrivateEventRef(args.eventRef);
    const requestFingerprint = privateEventCancelFingerprint({ eventRef, reason });
    try {
      const staffUser = await requireStaffUser(ctx, ["admin"]);
      const rows = await ctx.db
        .query("privateEvents")
        .withIndex("by_eventRef", (q) => q.eq("eventRef", eventRef))
        .take(2);
      if (rows.length > 1) throw new Error("Private event operation identity is ambiguous");
      const event = rows[0];
      if (!event) {
        throw new Error("Private event was not found");
      }
      privateEventResult(event);
      await assertPrivateEventIdentity(ctx, event);
      if (event.status === "cancelled") {
        return { role: "admin" as const, event: privateEventResult(event), reused: true };
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
        role: "admin" as const,
        event: privateEventResult({ ...event, status: "cancelled", cancelledAt: now, cancelReason: reason }),
        reused: false
      };
    } catch (error) {
      throw new ConvexError({ kind: "private_event_rejected", version: 1, operation: "cancel",
        lookup: { eventRef }, requestFingerprint,
        message: error instanceof Error ? error.message.slice(0, 500) : "Private event cancellation could not be recorded" });
    }
  }
});
