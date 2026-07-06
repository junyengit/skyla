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
- Checkout/POS catalog-priced lines carry exact code-owned catalog provenance
  and canonical line amounts; custom POS lines keep only staff reason metadata
- Stripe return URLs are allowlisted by server/Convex env
- Stripe Terminal accepts stored `saleRef` and idempotency key only
- Native POS loads Terminal readers through `/api/pos/readers`; no free-text
  reader/location controls should return
- `/api/pos/readers` requires staff auth and fails closed before exposing any
  reader records
- `/api/order-drafts/pos` may forward a staff-selected `readerId` selector, but
  must not forward browser-sent `terminalLocationId`
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
- Payment/readiness smokes fail if no-write draft line provenance or canonical
  line amounts drift from the code-owned catalog
- Protected branch checks are green: `ci-build`,
  `Analyze JavaScript and TypeScript`, and `Vercel`
- Production domain is not changed without approval
- Old backend/payment surfaces are not disabled before replacement verification

## Payment Readiness

- `/api/order-drafts/checkout` returns canonical totals and ignores fake client totals
- `/api/order-drafts/checkout` returns catalog provenance and canonical line
  amounts for adult, child, and add-on lines; linked acceptance verifies the
  same shape after Convex persistence
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
- `/api/pos/readers` returns only Convex allowlisted reader metadata to
  authenticated staff and returns `401 staff_auth_required` without auth
- `/api/order-drafts/pos` returns catalog provenance and canonical line amounts
  for ticket/cafe lines, while custom lines keep only reason metadata; linked
  acceptance verifies the same shape after Convex persistence
- `SKYLA_TERMINAL_READER_REGISTRY` has no duplicate reader IDs; paired
  locations are derived server-side, not trusted from the browser
- Legacy Supabase `stripe-checkout` returns `410` permanently for creation and
  old session verification in repo code; legacy `stripe-terminal` payment
  creation and reader setup also return `410` permanently
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
  plus allowed booking status transitions, voucher redeem/undo, typed
  announcement/hours config, and admin-only CSV exports. Export routes must use
  fixed column allowlists, formula-safe CSV cells, masked payment/Terminal
  identifiers, `Cache-Control: no-store`, and staff auth before Convex calls. Do
  not port refunds, hard deletes, clear-all, reset-all, pricing/menu edits,
  password changes, POS charging, or reader setup without typed Convex models,
  audit events, reconciliation rules, and rollback steps.

## Why These Gates Exist

- Unit tests protect shared pricing/contact constants and the temporary legacy-route bridge while the app is rebuilt.
- The artifact guard stops local exports, logs, PDFs, env files, and obvious secrets from reaching GitHub or Vercel.
- The smoke script is intentionally simple: it checks every transition route still returns `200`, and it verifies admin/POS compatibility pages carry `X-Robots-Tag: noindex, nofollow`.
- `bun run security:audit` currently fails only on high or critical advisories across production and dev tooling.
