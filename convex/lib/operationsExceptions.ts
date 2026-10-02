import type { MutationCtx, QueryCtx } from "../_generated/server";

export type OperationsExceptionCategory = "billing" | "checkout_attempt" | "terminal_attempt" | "ticket_delivery";

export type OperationsExceptionInput = {
  category: OperationsExceptionCategory;
  code: string;
  /** One row per problem; repeats only bump the occurrence count. */
  dedupeKey: string;
  moneyReceived: boolean;
  orderRef?: string;
  saleRef?: string;
  bookingRef?: string;
  providerSessionId?: string;
  providerPaymentIntentId?: string;
  providerEventId?: string;
  amountCents?: number;
  currency?: "usd";
  evidence?: Record<string, string | number | boolean | undefined>;
  now: number;
};

/**
 * Opens a staff-visible exception exactly once. The first evidence is kept
 * immutable; later occurrences only update counters. Nothing here moves money,
 * releases capacity or contacts the customer.
 */
export async function openOperationsException(ctx: MutationCtx, input: OperationsExceptionInput) {
  // Paid settlement calls this after recording money, so a duplicated row must
  // not throw. The newest row for the key decides: an open one only counts
  // the occurrence; a resolved one stays as its immutable history and the
  // recurring problem opens a fresh active blocker with its own evidence.
  const existing = await ctx.db
    .query("operationsExceptions")
    .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", input.dedupeKey))
    .order("desc")
    .first();
  if (existing && existing.status === "open") {
    await ctx.db.patch(existing._id, {
      occurrenceCount: existing.occurrenceCount + 1,
      lastSeenAt: input.now,
      updatedAt: input.now
    });
    return { exceptionId: existing._id, created: false };
  }

  const exceptionId = await ctx.db.insert("operationsExceptions", withoutUndefined({
    dedupeKey: input.dedupeKey,
    category: input.category,
    code: input.code,
    status: "open" as const,
    moneyReceived: input.moneyReceived,
    orderRef: input.orderRef,
    saleRef: input.saleRef,
    bookingRef: input.bookingRef,
    providerSessionId: input.providerSessionId,
    providerPaymentIntentId: input.providerPaymentIntentId,
    providerEventId: input.providerEventId,
    amountCents: input.amountCents,
    currency: input.currency,
    evidence: input.evidence ? scalarRecord(input.evidence) : undefined,
    occurrenceCount: 1,
    firstSeenAt: input.now,
    lastSeenAt: input.now,
    createdAt: input.now,
    updatedAt: input.now
  }));
  await ctx.db.insert("auditEvents", {
    action: "operations.exceptionOpened",
    entityType: input.orderRef ? "order" : input.saleRef ? "posSale" : "operationsException",
    entityRef: input.orderRef ?? input.saleRef ?? input.dedupeKey,
    metadata: scalarRecord({
      category: input.category,
      code: input.code,
      moneyReceived: input.moneyReceived,
      bookingRef: input.bookingRef,
      amountCents: input.amountCents
    }),
    createdAt: input.now
  });
  return { exceptionId, created: true };
}

/** Closes an automation-recoverable exception (e.g. email later sent). */
export async function resolveOperationsException(
  ctx: MutationCtx,
  dedupeKey: string,
  resolution: string,
  now: number
) {
  // Bounded and classified: the newest row is resolved only when it is the
  // single open row for the key. Two open rows are ambiguous and left for
  // staff; money exceptions are never closed here.
  const [existing, previous] = await ctx.db
    .query("operationsExceptions")
    .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
    .order("desc")
    .take(2);
  if (!existing || existing.status !== "open" || existing.moneyReceived) return false;
  if (previous?.status === "open") return false;
  await ctx.db.patch(existing._id, { status: "resolved", resolvedAt: now, resolution, updatedAt: now });
  await ctx.db.insert("auditEvents", {
    action: "operations.exceptionResolved",
    entityType: existing.orderRef ? "order" : existing.saleRef ? "posSale" : "operationsException",
    entityRef: existing.orderRef ?? existing.saleRef ?? dedupeKey,
    metadata: { category: existing.category, code: existing.code, resolution },
    createdAt: now
  });
  return true;
}

// Reads only the open billing subset, so resolved or non-billing history can
// never push an open billing exception out of the bounded read. Any non-empty
// result blocks tickets, so presence is all callers rely on.
const openBillingReadLimit = 50;

export async function openBillingExceptionsForOrder(ctx: QueryCtx | MutationCtx, orderRef: string) {
  return ctx.db
    .query("operationsExceptions")
    .withIndex("by_orderRef_status_category", (q) =>
      q.eq("orderRef", orderRef).eq("status", "open").eq("category", "billing")
    )
    .take(openBillingReadLimit);
}

export async function openBillingExceptionsForSale(ctx: QueryCtx | MutationCtx, saleRef: string) {
  return ctx.db
    .query("operationsExceptions")
    .withIndex("by_saleRef_status_category", (q) =>
      q.eq("saleRef", saleRef).eq("status", "open").eq("category", "billing")
    )
    .take(openBillingReadLimit);
}

export async function hasOpenBillingExceptionForOrder(ctx: QueryCtx | MutationCtx, orderRef: string) {
  const row = await ctx.db
    .query("operationsExceptions")
    .withIndex("by_orderRef_status_category", (q) =>
      q.eq("orderRef", orderRef).eq("status", "open").eq("category", "billing")
    )
    .first();
  return row !== null;
}

export async function hasOpenBillingExceptionForSale(ctx: QueryCtx | MutationCtx, saleRef: string) {
  const row = await ctx.db
    .query("operationsExceptions")
    .withIndex("by_saleRef_status_category", (q) =>
      q.eq("saleRef", saleRef).eq("status", "open").eq("category", "billing")
    )
    .first();
  return row !== null;
}

function scalarRecord(value: Record<string, string | number | boolean | undefined>) {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
  );
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
