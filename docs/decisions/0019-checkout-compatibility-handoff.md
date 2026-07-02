# ADR 0019: Checkout Compatibility Handoff

## Status

Accepted.

## Context

The primary `/checkout` route is now a Next.js App Router page. It calculates
draft totals through `/api/order-drafts/checkout`, starts Stripe Checkout only
from a stored Convex `orderRef`, and fails closed while Convex and Stripe
dashboard wiring are absent.

The compatibility `/checkout.html` file still served the old static checkout
markup. Even though legacy Stripe execution had been disabled, that page still
loaded `shared-data.js` and the large browser checkout script that historically
created bookings, called Supabase functions, and handled Kaskade/crypto status
polling from browser state.

## Decision

`/checkout.html` is now a small compatibility handoff to `/checkout`.

The old public `checkout.js` and `checkout.css` files are removed from
`apps/web/public`.

Production readiness checks now verify that `/checkout` and `/checkout.html`
do not expose:

- `shared-data.js`
- `checkout.js`
- `SkylaData.addBooking`
- `kaskade-payment`

Google Ads launch URLs now point directly at `/checkout`.

## Why This Is Better

- The active ticket path has one implementation: the native App Router
  checkout.
- The browser no longer downloads stale code that used to create bookings or
  call payment functions from client-side state.
- Compatibility links keep working because `/checkout.html` still returns a
  useful page and immediately points visitors to `/checkout`.
- The remaining payment safety contract is easier to reason about: server
  totals first, stored order refs before Stripe, and fail-closed behavior until
  Convex/Stripe dashboards are linked.

## Consequences

- Historical docs may still mention the old static checkout as prior state.
- Any external campaign or bookmark using `/checkout.html` should still land on
  the native checkout.
- Live card payment remains gated until Convex, Stripe secrets, and Stripe
  webhooks are configured in dashboards and accepted with test cards.
