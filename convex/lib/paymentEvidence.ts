import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type Ctx = QueryCtx | MutationCtx;
type PaymentEventDoc = Doc<"paymentEvents">;

/**
 * Bound per status subset when proving who owns a PaymentIntent. Reaching it
 * means ownership cannot be proven from what was read, never that a
 * conflicting owner is absent.
 */
export const intentOwnershipReadLimit = 500;

const paymentEventStatuses: ReadonlyArray<PaymentEventDoc["status"]> = [
  "created",
  "requires_payment",
  "processing",
  "paid",
  "failed",
  "refunded",
  "canceled"
];

export type IntentOwnership = { kind: "exclusive" } | { kind: "conflict" } | { kind: "unverified" };

/**
 * Every ledger row for a PaymentIntent, pending or settled, must belong to
 * one owner. Each status is read through its own index range, so a long run
 * of declines can never push a conflicting owner out of the read; a subset
 * that overflows its bound is reported as unverified.
 */
export async function checkIntentOwnership(
  ctx: Ctx,
  providerPaymentIntentId: string,
  owns: (row: PaymentEventDoc) => boolean
): Promise<IntentOwnership> {
  const groups = await Promise.all(
    paymentEventStatuses.map((status) =>
      ctx.db
        .query("paymentEvents")
        .withIndex("by_providerPaymentIntentId_status", (q) =>
          q.eq("providerPaymentIntentId", providerPaymentIntentId).eq("status", status)
        )
        .take(intentOwnershipReadLimit + 1)
    )
  );
  if (groups.some((rows) => rows.some((row) => !owns(row)))) return { kind: "conflict" };
  if (groups.some((rows) => rows.length > intentOwnershipReadLimit)) return { kind: "unverified" };
  return { kind: "exclusive" };
}

export type PaidIntentIdentity =
  | { kind: "none" }
  | { kind: "one"; row: PaymentEventDoc }
  /** Two paid rows for one PaymentIntent: the ledger itself needs reconciliation. */
  | { kind: "duplicate"; rows: PaymentEventDoc[] };

/**
 * The paid ledger row of one PaymentIntent, read with take(2) on its own
 * index: decline history is never read and duplicates are classified, so the
 * current payment's record is always found exactly, whatever its owner's
 * history looks like.
 */
export async function paidIdentityForIntent(ctx: Ctx, providerPaymentIntentId: string): Promise<PaidIntentIdentity> {
  const rows = await ctx.db
    .query("paymentEvents")
    .withIndex("by_providerPaymentIntentId_status", (q) =>
      q.eq("providerPaymentIntentId", providerPaymentIntentId).eq("status", "paid")
    )
    .take(2);
  if (rows.length > 1) return { kind: "duplicate", rows };
  return rows[0] ? { kind: "one", row: rows[0] } : { kind: "none" };
}

/**
 * The paid row(s) of one exact provider payment id (a Checkout Session or a
 * Terminal PaymentIntent), with take(2), independent of owner history. It
 * also finds legacy paid rows that never stored providerPaymentIntentId.
 */
export async function paidIdentityForProviderPayment(
  ctx: Ctx,
  provider: PaymentEventDoc["provider"],
  providerPaymentId: string
): Promise<PaidIntentIdentity> {
  const rows = await ctx.db
    .query("paymentEvents")
    .withIndex("by_provider_providerPaymentId_status", (q) =>
      q.eq("provider", provider).eq("providerPaymentId", providerPaymentId).eq("status", "paid")
    )
    .take(2);
  if (rows.length > 1) return { kind: "duplicate", rows };
  return rows[0] ? { kind: "one", row: rows[0] } : { kind: "none" };
}

export function identityRows(identity: PaidIntentIdentity): PaymentEventDoc[] {
  return identity.kind === "none" ? [] : identity.kind === "one" ? [identity.row] : identity.rows;
}

/**
 * An existing paid record is the current payment only when the intent read
 * and the provider-id read found the very same row and it carries exactly the
 * confirmed identity, amount and currency.
 */
export function samePaidRecord(
  byIntent: PaymentEventDoc | undefined,
  byProviderId: PaymentEventDoc | undefined,
  facts: { providerPaymentId: string; providerPaymentIntentId: string; amountCents?: number; currency?: "usd" }
) {
  return (
    byIntent !== undefined &&
    byProviderId !== undefined &&
    byIntent._id === byProviderId._id &&
    byIntent.providerPaymentId === facts.providerPaymentId &&
    byIntent.providerPaymentIntentId === facts.providerPaymentIntentId &&
    byIntent.amountCents === facts.amountCents &&
    byIntent.currency === facts.currency
  );
}

/** Bound on one owner's paid history; one more row is the overflow sentinel. */
export const ownerPaidReadLimit = 100;

/**
 * An order's or sale's paid rows. `overflow` means more exist than were read:
 * the prefix never proves that no other payment exists.
 */
export type OwnerPaidSummary = { rows: PaymentEventDoc[]; overflow: boolean };

export async function paidSummaryForSale(ctx: Ctx, saleRef: string): Promise<OwnerPaidSummary> {
  const rows = await ctx.db
    .query("paymentEvents")
    .withIndex("by_saleRef_status", (q) => q.eq("saleRef", saleRef).eq("status", "paid"))
    .take(ownerPaidReadLimit + 1);
  return { rows: rows.slice(0, ownerPaidReadLimit), overflow: rows.length > ownerPaidReadLimit };
}

export async function paidSummaryForOrder(ctx: Ctx, orderRef: string): Promise<OwnerPaidSummary> {
  const rows = await ctx.db
    .query("paymentEvents")
    .withIndex("by_orderRef_status", (q) => q.eq("orderRef", orderRef).eq("status", "paid"))
    .take(ownerPaidReadLimit + 1);
  return { rows: rows.slice(0, ownerPaidReadLimit), overflow: rows.length > ownerPaidReadLimit };
}

export async function hasPaidEventForSale(ctx: Ctx, saleRef: string) {
  const row = await ctx.db
    .query("paymentEvents")
    .withIndex("by_saleRef_status", (q) => q.eq("saleRef", saleRef).eq("status", "paid"))
    .first();
  return row !== null;
}

export async function hasPaidEventForIntent(ctx: Ctx, providerPaymentIntentId: string) {
  const row = await ctx.db
    .query("paymentEvents")
    .withIndex("by_providerPaymentIntentId_status", (q) =>
      q.eq("providerPaymentIntentId", providerPaymentIntentId).eq("status", "paid")
    )
    .first();
  return row !== null;
}
