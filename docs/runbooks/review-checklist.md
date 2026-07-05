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
- No legacy root static files are reintroduced; compatibility assets belong in
  `apps/web/public`
- No alternate package-manager lockfiles are reintroduced; Bun canary uses the
  root text `bun.lock`
- No secrets in source
- No new client-trusted payment authority
- Payment actions accept stored refs only, not browser totals
- Stripe return URLs are allowlisted by server/Convex env
- Stripe Terminal accepts stored `saleRef` and idempotency key only
- Staff-only payment routes forward bearer auth to Convex and fail closed
  without it
- Webhook work verifies signature, amount, currency, status, and idempotency
- Stripe webhooks use raw request bodies before JSON parsing
- Paid order and POS sale transitions require stored Convex order/sale,
  payment-event, amount, currency, status, and webhook idempotency
  reconciliation
- Convex Terminal create-intent and reader-process actions both require
  `SKYLA_POS_TERMINAL_ACCEPTANCE`, not just route-level checks
- `/admin.html` and `/pos.html` are noindex handoffs to native `/admin` and
  `/pos`; they must not load the retired staff JS/CSS/shared data facade
- Legacy Supabase `stripe-terminal` returns `410` for `setup-reader` as well as
  charge/reader bridge actions
- Native admin voucher redemption stores redeem/undo as
  `voucherRedemptionEvents` plus `auditEvents`; the route must not accept
  voucher quantities, totals, paid state, or entitlements from the browser

## Product

- Homepage loads
- Core navigation works
- Legal pages are reachable
- Ticket path is safe
- Admin and POS text remains high-contrast on the dark background
- Retired staff assets `admin.css`, `admin.js`, `pos.css`, `pos.js`, and
  `shared-data.js` stay absent from `apps/web/public`
- Admin/POS are not indexed
- `/pos` is an App Router route and is not indexed
- `/pos-next` is not indexed
- `/checkout.html` remains a handoff to `/checkout` and does not load
  `shared-data.js`, `checkout.js`, or legacy browser payment code
- Motion respects reduced motion
- `/about`, `/cafe`, `/checkout`, `/experiences`, `/members`, `/privacy`,
  `/terms`, `/admin`, `/pos`, and `/pos-next` are App Router routes with
  `.html` compatibility files where needed. `/admin.html` and `/pos.html` are
  handoff-only compatibility files; extensionless `/admin` and `/pos` should
  not be rewritten to them.
- Public `.html` compatibility files for `/about`, `/cafe`, `/experiences`,
  `/members`, `/privacy`, and `/terms` are handoff-only and do not load
  `styles.css`, route-specific public page CSS, `script.js`, `shared-data.js`,
  `SkylaData`, or third-party tracking snippets.
- `/members` and `/members.html` do not expose `shared-data.js` or
  `SkylaData.addMember`
- `/experiences` and `/experiences.html` do not expose `shared-data.js` or
  `SkylaData.addInquiry`

## Deployment

- Vercel preview builds
- Build logs are clean
- Preview smoke: `SMOKE_BASE_URL=<preview-url> bun run test:smoke`
- Preview payment smoke:
  `PAYMENT_SMOKE_BASE_URL=<preview-url> bun run test:payments`
- Preview readiness smoke:
  `PRODUCTION_READINESS_BASE_URLS=<preview-url> bun run test:production-readiness`
- Production apex smoke: `SMOKE_BASE_URL=https://skydeckla.com bun run test:smoke`
- Production `www` smoke: `SMOKE_BASE_URL=https://www.skydeckla.com bun run test:smoke`
- Production payment smoke on the latest Vercel deployment, apex, and `www`
- Production readiness smoke on the latest Vercel deployment, apex, and `www`
- Protected branch checks are green: `ci-build`,
  `Analyze JavaScript and TypeScript`, and `Vercel`
- Production domain is not changed without approval
- Old backend/payment surfaces are not disabled before replacement verification

## Payment Readiness

- `/api/order-drafts/checkout` returns canonical totals and ignores fake client totals
- Preview checkout draft POST returns `persisted: true` before payment cutover
- Stripe Checkout action takes `orderRef` and draft `idempotencyKey`
- Stripe Checkout action does not accept `amountCents`, `currency`, or line items from the browser
- `/checkout.html` hands off to `/checkout` and does not load `checkout.js`,
  `checkout.css`, `shared-data.js`, `SkylaData`, or Kaskade browser payment
  markers
- `apps/web/public/checkout.js` and `apps/web/public/checkout.css` are absent
- `/api/payments/stripe-terminal` takes `saleRef` and draft `idempotencyKey`
- `/api/payments/stripe-terminal` does not accept `amountCents`, `readerId`, or
  `terminalLocationId` from the browser
- Legacy Supabase `stripe-checkout` and `stripe-terminal` payment creation and
  reader setup return `410` permanently in repo code
- Convex has `SKYLA_STRIPE_MODE` in the correct environment
- Convex has `STRIPE_SECRET_KEY` in the correct environment and matching
  `SKYLA_STRIPE_MODE`
- Convex has `SKYLA_PAYMENT_RETURN_ORIGINS` in the correct environment
- Convex has `SKYLA_TERMINAL_READER_REGISTRY` before POS reader handoff testing
- Vercel has `NEXT_PUBLIC_CONVEX_URL` in the correct environment
- Stripe webhook secret is configured before paid-order completion moves to Convex
- Stripe dashboard webhook endpoint points to the Convex site URL, not the old Supabase function
- Stripe Terminal PaymentIntent webhooks subscribe to succeeded, payment_failed,
  and canceled events before native `/pos` handles live card-present sales
- Kaskade and non-payment legacy paths stay enabled or explicitly disabled until replacements pass acceptance
- `/api/admin/config` writes only typed announcement/hours data, requires admin
  staff, and records `admin.config.update` audit events
- Native admin booking lookup/check-in should stay limited to staff-gated lookup
  plus allowed booking status transitions and voucher redeem/undo. Do not port
  refunds, hard deletes, clear-all, reset-all, pricing/menu edits, password
  changes, POS charging, or reader setup without typed Convex models, audit
  events, reconciliation rules, and rollback steps.

## Why These Gates Exist

- Unit tests protect shared pricing/contact constants and the temporary legacy-route bridge while the app is rebuilt.
- The artifact guard stops local exports, logs, PDFs, env files, and obvious secrets from reaching GitHub or Vercel.
- The smoke script is intentionally simple: it checks every transition route still returns `200`, and it verifies admin/POS compatibility pages carry `X-Robots-Tag: noindex, nofollow`.
- `bun run security:audit` currently fails only on high or critical advisories across production and dev tooling.
