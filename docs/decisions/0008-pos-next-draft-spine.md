# 0008: Add POS Next Draft Spine Before Live Terminal Cutover

Date: 2026-06-30

## Status

Accepted for this migration slice. Later slices added the sale-ref-only Terminal
action, server-driven reader handoff, and signed PaymentIntent webhook
reconciliation; see decisions 0009, 0010, and 0006 for the current payment
state.

## Context

The live legacy POS page can still create Stripe Terminal payment intents
through the old Supabase bridge, and that bridge accepts browser cart amounts.
That is the exact payment risk the migration is removing.

The shared `@skyla/payments` package and Convex `orderDrafts` functions already
know how to price POS sale drafts from ticket, cafe, and custom selections.
However, staff auth and a sale-reference-only Terminal action are not fully
wired into the deployed Next/Vercel path yet.

## Decision

Add a native, non-live POS draft route at `/pos-next` and a Next route handler
at `/api/order-drafts/pos`.

The route handler:

- accepts POS selections, not browser totals
- recalculates ticket and cafe prices from `@skyla/payments`
- validates custom charges with a bounded amount and required reason
- returns canonical POS totals even when Convex is not configured
- only attempts Convex persistence when it has `NEXT_PUBLIC_CONVEX_URL`,
  `idempotencyKey`, and a staff bearer token

The UI:

- shows a high-contrast staff register surface
- lets staff build and review a cart
- displays the reviewed server total
- initially kept Terminal payment disabled until a Convex Terminal action could
  accept only a stored `saleRef`

## Consequences

This creates a safe proving ground for POS pricing without breaking the current
live register. It also gives tests a stable place to prove that browser totals
are ignored.

The migration is not complete after this decision. The remaining POS payment
work is to store the draft under real staff auth, create a Terminal payment
intent from `saleRef`, and then replace the legacy `/pos` path.
