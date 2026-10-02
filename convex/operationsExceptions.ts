import { v } from "convex/values";

import { query } from "./_generated/server";
import { requireStaffUser } from "./lib/auth";

const maxLimit = 50;

/**
 * Bounded staff read of billing, checkout-attempt and ticket-delivery
 * exceptions for the operations milestone. Read-only: resolving, refunding
 * or re-sending stays an explicit, separately authorized staff action.
 */
export const listOperationsExceptions = query({
  args: {
    status: v.optional(v.union(v.literal("open"), v.literal("resolved"))),
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    await requireStaffUser(ctx, ["admin", "viewer"]);
    const limit = args.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
      throw new Error(`limit must be an integer from 1 to ${maxLimit}`);
    }
    const status = args.status ?? "open";
    const rows = await ctx.db
      .query("operationsExceptions")
      .withIndex("by_status_createdAt", (q) => q.eq("status", status))
      .order("desc")
      .take(limit + 1);
    return {
      status,
      capped: rows.length > limit,
      exceptions: rows.slice(0, limit).map((row) => ({
        category: row.category,
        code: row.code,
        status: row.status,
        moneyReceived: row.moneyReceived,
        orderRef: row.orderRef,
        saleRef: row.saleRef,
        bookingRef: row.bookingRef,
        providerSessionIdMasked: maskProviderId(row.providerSessionId),
        providerPaymentIntentIdMasked: maskProviderId(row.providerPaymentIntentId),
        amountCents: row.amountCents,
        currency: row.currency,
        evidence: row.evidence,
        occurrenceCount: row.occurrenceCount,
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt,
        resolvedAt: row.resolvedAt,
        resolution: row.resolution
      }))
    };
  }
});

function maskProviderId(value: string | undefined) {
  if (!value) return undefined;
  return value.length <= 12 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}

import type { BillingExceptionPage } from "@skyla/payments";
import {
  assertBillingOutput, billingReadFailure, decodeBillingCursor, encodeBillingCursor,
  projectBillingException, requireBillingStaff, rethrowBillingRead
} from "./lib/billingDetails";

/** Immutable native order; mutable status is a filter, never a complete current-status snapshot. */
export const listOperationsExceptionsPage = query({
  args: {
    status: v.optional(v.union(v.literal("open"), v.literal("resolved"))), limit: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())), endCursor: v.optional(v.union(v.string(), v.null()))
  },
  handler: async (ctx, args): Promise<BillingExceptionPage> => {
    try {
      const role = await requireBillingStaff(ctx);
      const query = { status: args.status ?? "open", limit: args.limit ?? 25 };
      if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 50) billingReadFailure("billing_cursor_invalid");
      const retrievedAt = Date.now();
      const start = args.cursor === undefined || args.cursor === null ? null : decodeBillingCursor(args.cursor, query, retrievedAt);
      const end = args.endCursor === undefined || args.endCursor === null ? null : decodeBillingCursor(args.endCursor, query, retrievedAt);
      if (start && end && start.cutoff !== end.cutoff) billingReadFailure("billing_cursor_invalid");
      const cutoff = start?.cutoff ?? end?.cutoff ?? retrievedAt;
      const startCursor = args.cursor ?? null; const endCursor = args.endCursor ?? null;
      if (start && end && start.native === end.native) return { version: 1, role, query, retrievedAt, cutoff, startCursor, endCursor,
        page: [], continueCursor: null, splitCursor: null, pageStatus: null, isDone: false, segmentDone: true, capped: true };
      const native = await ctx.db.query("operationsExceptions")
        .filter(q => q.and(q.eq(q.field("status"), query.status), q.lte(q.field("_creationTime"), cutoff)))
        .order("desc").paginate({ numItems: query.limit, cursor: start?.native ?? null, ...(end ? { endCursor: end.native } : {}),
          maximumRowsRead: 100, maximumBytesRead: 256 * 1024 });
      const pageStatus = native.pageStatus ?? null;
      if (pageStatus !== null && pageStatus !== "SplitRecommended" && pageStatus !== "SplitRequired") billingReadFailure("billing_read_unverified");
      if (pageStatus && (!native.splitCursor || native.splitCursor === start?.native || native.splitCursor === native.continueCursor)) billingReadFailure("billing_read_unverified");
      const segmentDone = !pageStatus && (end ? native.continueCursor === end.native || native.isDone : native.isDone);
      const isDone = !end && segmentDone;
      if (!segmentDone && (!native.continueCursor || native.continueCursor === start?.native)) billingReadFailure("billing_read_unverified");
      const page = native.page.map(projectBillingException);
      if (page.some(row => row.recordedAt > cutoff || row.status !== query.status) || new Set(page.map(row => row.exceptionId)).size !== page.length) billingReadFailure("billing_read_unverified");
      const result: BillingExceptionPage = { version: 1, role, query, retrievedAt, cutoff, startCursor, endCursor, page,
        continueCursor: segmentDone ? null : encodeBillingCursor(query, cutoff, native.continueCursor),
        splitCursor: pageStatus && native.splitCursor ? encodeBillingCursor(query, cutoff, native.splitCursor) : null,
        pageStatus, isDone, segmentDone, capped: !isDone };
      assertBillingOutput(result); return result;
    } catch (error) { return rethrowBillingRead(error); }
  }
});
