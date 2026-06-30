# Decision 0006: Convex Stripe Webhook Reconciliation

## Status

Accepted for the Stripe payment migration.

## Context

Stripe Checkout Session creation now starts from stored Convex orders. The old
Supabase webhook verified signatures but rebuilt bookings from Stripe metadata
and swallowed write errors. That is not enough for Convex-owned payments.

## Decision

Add a Convex HTTP action at `POST /stripe-webhook` that:

- reads the raw request body before parsing JSON
- verifies the `Stripe-Signature` header with `STRIPE_WEBHOOK_SECRET`
- enforces Stripe's timestamp tolerance
- records webhook event IDs in `webhookEvents`
- ignores unsupported events intentionally
- marks orders paid only after reconciling:
  - Checkout Session event type
  - `payment_status: "paid"`
  - Stripe Checkout Session ID
  - stored `orderRef`
  - stored Convex order amount
  - stored Convex payment-event amount
  - currency
  - `expectedProvider: "stripe"`
  - order status `payment_pending` or already `paid`

## Why This Is Good

- Stripe metadata identifies an order but does not decide what was purchased.
- Duplicate Stripe events become harmless.
- Amount mismatches become durable failed webhook events instead of paid orders.
- Real storage failures still return an error so Stripe can retry.

## Consequences

- Real cutover still requires a linked Convex deployment and a Stripe dashboard
  endpoint pointed at `https://<convex-site-url>/stripe-webhook`.
- Kaskade and Stripe Terminal still need equivalent ref-backed replacements.
- The frontend checkout must still be wired to the Convex action before this
  webhook receives relevant live Checkout Session events.
