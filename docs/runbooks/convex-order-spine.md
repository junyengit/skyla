# Convex Order Spine Runbook

## Purpose

This runbook explains the new order-authority foundation for humans and agents.
It is not a live payment cutover runbook yet.

## What Exists Now

- `convex/schema.ts`: target tables and indexes for the Convex backend.
- `packages/payments`: pure TypeScript pricing and order draft contracts.
- `apps/web/app/api/order-drafts/checkout/route.ts`: a server route that accepts
  product selections and returns canonical totals.

This route is not used by the live compatibility checkout yet. Returned drafts
are transient and are not persisted to Convex; there is no `orderRef` until the
next mutation/deployment PR.

## Why This Is Safer

The old payment path lets the browser send amounts to backend payment functions.
The new path starts with a server-owned order draft. The browser can ask for a
package, guest count, and add-ons, but the server calculates:

- line items
- child pricing
- booking fee
- subtotal
- total

The next payment PR should create provider intents from a stored `orderRef`,
not from a browser-supplied amount.

## Agent Data

Current canonical package prices:

| Key | Name | Price cents | Bookable |
| --- | --- | ---: | --- |
| `general` | General Admission | 2900 | yes |
| `drink` | Deck + Drink | 3700 | yes |
| `date-night` | Date Night Experience | 9800 | no |
| `champagne-room` | Champagne Room | 0 plus room fee | no |
| `family-suite` | Family Suite | 0 plus room fee | no |

Current order draft API:

```http
POST /api/order-drafts/checkout
Content-Type: application/json

{
  "packageKey": "general",
  "adults": 2,
  "children": 1,
  "addons": { "matcha": 1 }
}
```

Expected response shape:

```json
{
  "draft": {
    "channel": "online",
    "status": "draft",
    "currency": "usd",
    "subtotalCents": 8100,
    "feeCents": 405,
    "totalCents": 8505,
    "lines": [
      {
        "kind": "ticket",
        "productKey": "general",
        "name": "General Admission",
        "quantity": 2,
        "unitAmountCents": 2900,
        "lineTotalCents": 5800
      },
      {
        "kind": "ticket",
        "productKey": "general",
        "name": "General Admission Child",
        "quantity": 1,
        "unitAmountCents": 1500,
        "lineTotalCents": 1500
      },
      {
        "kind": "addon",
        "productKey": "matcha",
        "name": "Ceremonial Matcha Latte",
        "quantity": 1,
        "unitAmountCents": 800,
        "lineTotalCents": 800
      }
    ]
  }
}
```

## Local Validation

Use this on any branch, even before the real Convex deployment is linked:

```bash
bun run convex:schema:typecheck
```

Use this only after `CONVEX_DEPLOYMENT` is configured by linking a real Convex
project:

```bash
bun run convex:codegen
```

During this PR, `bunx convex codegen --dry-run --typecheck enable` was attempted
and correctly stopped with `No CONVEX_DEPLOYMENT set`. That is why the lightweight
schema typecheck is committed as the local gate and codegen is left for the
deployment-linked follow-up.

## Next Steps

1. Link a real Convex deployment.
2. Generate Convex API/server types.
3. Add Convex mutations to persist checkout order drafts and POS sale drafts.
4. Add Stripe/Kaskade/Terminal actions that only accept stored refs.
5. Add webhook HTTP actions that verify signatures, expected amounts, currency,
   status, and idempotency.
6. Dual-run against Supabase and reconcile before cutover.
