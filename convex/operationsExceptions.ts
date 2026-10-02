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
