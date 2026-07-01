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
- Stripe Terminal accepts stored `saleRef` and idempotency key only
- Staff-only payment routes forward bearer auth to Convex and fail closed
  without it
- Webhook work verifies signature, amount, currency, status, and idempotency
- Stripe webhooks use raw request bodies before JSON parsing
- Paid-order transitions require stored Convex order/payment-event reconciliation

## Product

- Homepage loads
- Core navigation works
- Legal pages are reachable
- Ticket path is safe
- Admin and POS text remains high-contrast on the dark background
- Admin/POS are not indexed
- `/pos-next` is not indexed
- Legacy `/checkout.html` card payment stays disabled while `/checkout` is the
  card path
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
- `/api/payments/stripe-terminal` takes `saleRef` and draft `idempotencyKey`
- `/api/payments/stripe-terminal` does not accept `amountCents`, `readerId`, or
  `terminalLocationId` from the browser
- Legacy Supabase `stripe-checkout` and `stripe-terminal` payment creation
  return `410` unless an explicit transition env var re-enables them
- Convex has `STRIPE_SECRET_KEY` in the correct environment
- Convex has `SKYLA_PAYMENT_RETURN_ORIGINS` in the correct environment
- Convex has `SKYLA_TERMINAL_READER_REGISTRY` before POS reader handoff testing
- Vercel has `NEXT_PUBLIC_CONVEX_URL` in the correct environment
- Stripe webhook secret is configured before paid-order completion moves to Convex
- Stripe dashboard webhook endpoint points to the Convex site URL, not the old Supabase function
- Kaskade and Terminal legacy payment paths stay enabled or explicitly disabled until replacements pass acceptance

## Why These Gates Exist

- Unit tests protect shared pricing/contact constants and the temporary legacy-route bridge while the app is rebuilt.
- The artifact guard stops local exports, logs, PDFs, env files, and obvious secrets from reaching GitHub or Vercel.
- The smoke script is intentionally simple: it checks every transition route still returns `200`, and it verifies admin/POS compatibility pages carry `X-Robots-Tag: noindex, nofollow`.
- `bun run security:audit` currently fails only on high or critical advisories across production and dev tooling.
