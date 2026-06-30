# Review Checklist

Use this after each major phase.

## Code

- `bun install --frozen-lockfile`
- `bun run lint`
- `bun run typecheck`
- `bun run test:unit`
- `bun run build`
- `bun run security:artifacts`
- `bun run security:audit`
- `bun run check`
- No accidental generated artifacts in `git status`
- No secrets in source
- No new client-trusted payment authority
- Payment actions accept stored refs only, not browser totals
- Stripe return URLs are allowlisted by server/Convex env
- Webhook work verifies signature, amount, currency, status, and idempotency

## Product

- Homepage loads
- Core navigation works
- Legal pages are reachable
- Ticket path is safe
- Admin and POS text remains high-contrast on the dark background
- Admin/POS are not indexed
- Motion respects reduced motion
- Legacy route bridge still covers `/about`, `/cafe`, `/experiences`, `/checkout`, `/members`, `/privacy`, `/terms`, `/admin`, and `/pos`

## Deployment

- Vercel preview builds
- Build logs are clean
- Preview smoke: `SMOKE_BASE_URL=<preview-url> bun run test:smoke`
- Production apex smoke: `SMOKE_BASE_URL=https://skydeckla.com bun run test:smoke`
- Production `www` smoke: `SMOKE_BASE_URL=https://www.skydeckla.com bun run test:smoke`
- Production domain is not changed without approval
- Old backend/payment surfaces are not disabled before replacement verification

## Payment Readiness

- `/api/order-drafts/checkout` returns canonical totals and ignores fake client totals
- Preview checkout draft POST returns `persisted: true` before payment cutover
- Stripe Checkout action takes `orderRef` and draft `idempotencyKey`
- Stripe Checkout action does not accept `amountCents`, `currency`, or line items from the browser
- Convex has `STRIPE_SECRET_KEY` in the correct environment
- Convex has `SKYLA_PAYMENT_RETURN_ORIGINS` in the correct environment
- Vercel has `NEXT_PUBLIC_CONVEX_URL` in the correct environment
- Stripe webhook secret is configured before paid-order completion moves to Convex
- Kaskade and Terminal legacy payment paths stay enabled or explicitly disabled until replacements pass acceptance

## Why These Gates Exist

- Unit tests protect shared pricing/contact constants and the temporary legacy-route bridge while the app is rebuilt.
- The artifact guard stops local exports, logs, PDFs, env files, and obvious secrets from reaching GitHub or Vercel.
- The smoke script is intentionally simple: it checks every transition route still returns `200`, and it verifies admin/POS compatibility pages carry `X-Robots-Tag: noindex, nofollow`.
- `bun run security:audit` currently fails only on high or critical advisories across production and dev tooling.
