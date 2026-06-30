# Convex Deployment And Vercel Env Runbook

## Purpose

This runbook connects the code-side Convex order draft work to the dashboard
work that still has to happen. It is written for both humans doing dashboard
setup and agents verifying the result afterward.

## Current State

- Vercel project: `junyen-enterprises/web`
- Vercel project ID: `prj_fhlOjcwSbnPAuLi8tTiGbhjVomnr`
- Vercel team ID: `team_3kWPO8fPD6E7x39voGoNNeog`
- Local Vercel link path: `apps/web/.vercel/project.json` (ignored)
- Vercel env status checked on 2026-06-30: no environment variables exist for
  `junyen-enterprises/web`.
- Local Convex status: anonymous-only local deployment in root `.env.local`.
- Cloud Convex status: not linked yet.

## Why This Matters

Checkout draft persistence is now coded, but the route only persists when it
has a real Convex URL and the caller sends an `idempotencyKey`. Until then, it
keeps returning transient server-priced totals so the public site does not break.

```mermaid
flowchart LR
  route["/api/order-drafts/checkout"]
  env{"NEXT_PUBLIC_CONVEX_URL set?"}
  key{"idempotencyKey sent?"}
  transient["Return transient canonical totals"]
  convex["Call Convex orderDrafts.createCheckoutOrderDraft"]
  stored["Return persisted orderRef + totals"]

  route --> env
  env -- no --> transient
  env -- yes --> key
  key -- no --> transient
  key -- yes --> convex --> stored
```

## Dashboard Setup

1. Create or link the Skyla Convex project in the Convex dashboard.
2. Run Convex locally against the real project, not anonymous local mode:

```bash
PATH="$HOME/.bun/bin:$PATH" bunx convex dev --configure existing --dev-deployment cloud --typecheck enable
```

If this is a new Convex project rather than an existing one:

```bash
PATH="$HOME/.bun/bin:$PATH" bunx convex dev --configure new --dev-deployment cloud --project skyla --typecheck enable
```

3. Confirm root `.env.local` contains a non-anonymous `CONVEX_DEPLOYMENT` and
   an HTTPS `CONVEX_URL`.
4. Add the public Convex URL to Vercel:

```bash
cd apps/web
printf '%s' "$CONVEX_URL" | PATH="$HOME/.bun/bin:$PATH" bunx vercel env add NEXT_PUBLIC_CONVEX_URL production preview development
```

The value should look like `https://<deployment>.convex.cloud`.

5. Add Stripe action envs to Convex before testing payment creation:

```bash
PATH="$HOME/.bun/bin:$PATH" bunx convex env set STRIPE_SECRET_KEY "$STRIPE_SECRET_KEY"
PATH="$HOME/.bun/bin:$PATH" bunx convex env set SKYLA_PAYMENT_RETURN_ORIGINS "https://skydeckla.com,https://www.skydeckla.com"
```

Use Stripe test-mode values for Preview/Development. Do not paste secret values
into PRs, logs, or docs.

6. Pull local web envs if you want the Next route to use Convex locally:

```bash
cd apps/web
PATH="$HOME/.bun/bin:$PATH" bunx vercel env pull .env.local --yes
```

## Verification

Use this first. It prints variable presence and safety status without printing
secret values:

```bash
PATH="$HOME/.bun/bin:$PATH" bun run convex:env:check
```

Expected cloud-ready result:

```json
{
  "readyForCloudPersistence": true
}
```

Then run:

```bash
PATH="$HOME/.bun/bin:$PATH" bun run convex:codegen
PATH="$HOME/.bun/bin:$PATH" bun run check
```

After a Vercel preview deploy, verify persistence by posting with an
`idempotencyKey`:

```bash
curl -sS -X POST "$PREVIEW_URL/api/order-drafts/checkout" \
  -H 'content-type: application/json' \
  --data '{
    "packageKey": "general",
    "adults": 2,
    "children": 1,
    "addons": { "matcha": 1 },
    "customerEmail": "guest@example.com",
    "idempotencyKey": "checkout_20260704_abc123",
    "totalCents": 1
  }'
```

Expected response markers:

- `persisted: true`
- `orderRef` starts with `SKY`
- totals are canonical: subtotal `8100`, fee `405`, total `8505`
- the fake `totalCents: 1` is ignored

## Before Stripe Cutover

Do not wire the public checkout page to Stripe through Convex until all of
these are true:

- `bun run convex:env:check` reports `readyForCloudPersistence: true`
- Vercel has `NEXT_PUBLIC_CONVEX_URL` in Preview and Production
- Convex has `STRIPE_SECRET_KEY`
- Convex has `SKYLA_PAYMENT_RETURN_ORIGINS`
- Preview `/api/order-drafts/checkout` returns `persisted: true`
- `bun run check` passes
- `bun run security:audit` passes
- A Stripe test-mode checkout can be created from a stored `orderRef`
- Webhook work is planned and not confused with session creation

Rollback is simple at this stage: leave the order draft route enabled and do
not call `payments.createStripeCheckoutSession` from the frontend.

## Agent Notes

- Do not set Vercel production to an anonymous local Convex URL.
- Do not claim cloud persistence is live until `bun run convex:env:check`
  returns ready and a preview POST returns `persisted: true`.
- `NEXT_PUBLIC_CONVEX_URL` is safe to expose; Convex auth and function guards
  still enforce protected staff flows server-side.
- Stripe Checkout session creation now exists as a Convex action, but it is not
  live until the env and frontend cutover gates above pass.
- Kaskade, Terminal, and webhook actions are still separate work.
