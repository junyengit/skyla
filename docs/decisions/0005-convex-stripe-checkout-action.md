# Decision 0005: Convex-Owned Stripe Checkout Session Creation

## Status

Accepted for the next payment migration slice.

## Context

The legacy Stripe and Kaskade functions accept payment amounts from browser
code. That made the old site easy to keep alive, but it is not the security
model we want for the rebuilt stack.

Convex now stores checkout drafts with canonical totals. The next safe step is
to create provider payments from those stored records only.

## Decision

Add a Convex action for Stripe Checkout Sessions:

- Public action: `payments.createStripeCheckoutSession`
- Public inputs: `orderRef`, draft `idempotencyKey`, `successUrl`,
  `cancelUrl`
- Internal data source: stored `orders` and `orderLineItems`
- External side effect: Stripe `checkout.sessions.create`
- Ledger write: `paymentEvents`
- Order state update: `payment_pending`, `expectedProvider: "stripe"`

The action does not accept browser-supplied `amountCents`, `currency`, line
items, booking metadata, or provider IDs.

Return URLs are restricted by the Convex env variable
`SKYLA_PAYMENT_RETURN_ORIGINS`.

## Why This Is Good

- The browser can choose what it wants to buy, but not what it costs.
- Stripe idempotency and Convex `paymentEvents` make retries safer.
- The action is small enough to test before replacing the live checkout page.
- Future webhooks can compare Stripe amount/currency/status against Convex
  state instead of trusting Stripe metadata as order truth.

## Consequences

- Convex needs `STRIPE_SECRET_KEY` before the action can run.
- Convex needs `SKYLA_PAYMENT_RETURN_ORIGINS` before the action can return a
  session URL.
- The frontend checkout cutover is still separate work.
- Webhooks are still required before a paid order should be considered fully
  Convex-owned.
