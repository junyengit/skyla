# Phase 2 Discovery Notes

Last updated: 2026-06-30

This file captures read-only subagent findings that should guide implementation. It is intentionally more direct than the roadmap: paths, risks, and test targets live here so future agents do not need to rediscover the same map.

Snapshot note: these findings were captured before the Bun/root-cleanup branch.
For current package-manager and root-layout state, use
`docs/migration-progress.md` and the runbooks.

## Convex And Functionality Findings

Current runtime reality:

- `apps/web/app/page.tsx` is the only rebuilt App Router product page.
- `apps/web/next.config.mjs` rewrites legacy routes such as `/checkout`, `/admin`, `/pos`, and `/members` into static files under `apps/web/public`.
- `apps/web/public/shared-data.js` is still the active browser data facade.
- `shared-data.js` uses localStorage for packages, addons, menu, bookings, hours, announcements, and password.
- `shared-data.js` syncs to Supabase from browser-side code.
- Active Supabase tables inferred from runtime code: `bookings`, `members`, `inquiries`, `config`.

High-risk payment/admin paths:

- `apps/web/public/checkout.js` calculates subtotal, fees, and booking payloads in the browser.
- `apps/web/public/checkout.js` finalizes Stripe bookings from the browser.
- `apps/web/public/checkout.js` creates crypto pending bookings from the browser.
- `supabase/functions/stripe-checkout/index.ts` accepts client-sent `amountCents`.
- `supabase/functions/kaskade-payment/index.ts` accepts client-sent `priceUsd`.
- `supabase/functions/stripe-webhook/index.ts` writes booking blobs after webhook verification, but it is still part of the Supabase-era pipeline.
- `apps/web/public/admin.js` can fall back to a local password path.
- `apps/web/public/pos.js` creates Terminal PaymentIntents from client cart totals.
- `apps/web/public/pos.js` persists ticket lines but not all cafe/custom POS sales as first-class durable sales.

Recommended Convex tables:

- `products` or `packages`
- `addons`
- `menuItems`
- `hours`
- `announcements`
- `orders`
- `orderLineItems`
- `bookings`
- `bookingVouchers`
- `voucherRedemptions`
- `posSales`
- `posSaleLines`
- `paymentEvents`
- `webhookEvents`
- `memberApplications`
- `inquiries`
- `staffUsers`
- `auditLog`
- `emailEvents`

Recommended Convex indexes:

- `bookings.by_bookingRef`
- `bookings.by_visitDate_status`
- `bookings.by_emailLower`
- `orders.by_orderRef`
- `orders.by_status_createdAt`
- `orders.by_providerPaymentId`
- `paymentEvents.by_provider_event`
- `webhookEvents.by_provider_eventId`
- `memberApplications.by_status_createdAt`
- `inquiries.by_status_createdAt`
- `staffUsers.by_subject`
- `auditLog.by_actor_createdAt`
- `config.by_key`

Recommended server boundaries:

- Public reads: `getPublicConfig`, `listBookablePackages`, `listCafeMenu`, `getAnnouncement`.
- Public writes: `createMemberApplication`, `createInquiry`, `createOrderDraft`.
- Payment actions: `stripeCreatePaymentIntent`, `stripeCreateCheckoutSession`, `kaskadeCreatePayment`, `kaskadeCheckStatus`.
- Staff actions: `stripeTerminalConnectionToken`, `stripeTerminalCreateIntent`, `stripeTerminalSetupReader`.
- Webhook HTTP actions: Stripe and Kaskade raw-body signature verification, idempotency, expected amount/currency/status checks, and durable event ledgers.
- Admin/POS mutations: check-in, cancellation, voucher redemption, pricing/menu/hours/announcement updates, member status updates, and audit logging.

## Repo And Asset Cleanup Findings

Root static files should move only after Vercel custom-domain smoke tests are stable and GitHub Pages rollback is explicitly retired:

```text
index.html
about.html
about.css
cafe.html
cafe.css
experiences.html
experiences.css
members.html
members.css
checkout.html
checkout.css
checkout.js
admin.html
admin.css
admin.js
pos.html
pos.css
pos.js
privacy.html
terms.html
styles.css
script.js
shared-data.js
robots.txt
sitemap.xml
```

Recommended landing place after rollback retirement:

```text
legacy-static/public-site/
```

Active compatibility bridge to keep until App Router replacements exist:

```text
apps/web/public/*.html
apps/web/public/*.css
apps/web/public/*.js
apps/web/public/robots.txt
apps/web/public/sitemap.xml
apps/web/public/images/
```

Asset recommendation:

- Treat `apps/web/public/images/` as canonical active assets.
- Root `images/` duplicates `apps/web/public/images/` and can be removed after rollback is retired, or moved to `legacy-static/public-site/images/` if the legacy archive must be self-contained.

Generated local artifacts that can be deleted when convenient:

```text
apps/web/.next/
apps/web/.turbo/
apps/web/tsconfig.tsbuildinfo
packages/config/dist/
packages/ui/dist/
**/node_modules/
```

## Route Migration Test Targets

Every route replacement should prove:

- `/route` works.
- `/route.html` redirects or rewrites intentionally.
- The route no longer loads `shared-data.js` when the App Router replacement is complete.
- Admin and POS stay `noindex`.
- Mobile and desktop layouts do not overlap.
- Legacy links either keep working or redirect predictably.

Priority route order:

1. `/privacy`, `/terms`
2. `/about`, `/cafe`, `/experiences`
3. `/members`
4. `/checkout`
5. `/admin`
6. `/pos`

## Payment And Admin Test Targets

- Browser amount tampering cannot change Stripe/Kaskade charge amount.
- Replayed webhooks are idempotent.
- Browser close after payment still yields one finalized order.
- Admin roles block unauthenticated, viewer-only, and wrong-role users.
- Check-in is safe under concurrent requests.
- Voucher redemption cannot exceed quantity.
- POS retries reuse the same PaymentIntent.
- Ticket, cafe, and custom POS sale lines are all persisted.
- User-entered admin/member/inquiry fields are escaped in list/detail/export views.

## QA And Security Findings

P0 findings:

- Payment creation is still client-authoritative. Browser code sends `amountCents` or `priceUsd` to backend functions, and the Supabase-era Stripe/Kaskade functions do not look up a server-owned order before creating provider payments.
- Admin/POS authorization is not server-enforced yet. `/admin` and `/pos` are static bridge routes with `noindex` headers, not protected server routes.
- Admin still has a local password fallback path.
- Stripe Terminal function actions do not yet enforce explicit staff role checks at the server boundary.

P1 findings:

- Legacy bridge scripts have stored-XSS surfaces through `innerHTML` paths for announcement, booking table, checkout ticket/status, and POS catalog/cart rendering.
- `apps/web/eslint.config.mjs` ignores `public/**/*.js`, so those bridge scripts are intentionally outside the current lint gate.
- CI now includes unit tests and the tracked artifact guard on the QA/security baseline branch, but integration, e2e, and visual tests are still pending.
- GitHub repo hardening is partially implemented in code with Dependabot, CodeQL, CODEOWNERS, and `SECURITY.md`; dashboard-side branch protection, rulesets, vulnerability alerts, and required checks still need confirmation.

P2 findings:

- Bun is planned but not adopted. Current package manager is still `pnpm@11.9.0`, CI uses pnpm, `bun.lock` does not exist, and local `bun -v` failed in the current environment.
- Dependency audit found one moderate advisory through `postcss@8.4.31` in the current lockfile.
- No tracked `.env`, `output`, `tmp`, CSV, PDF, or log artifacts were found.
- Public client keys exist in legacy browser files; they are not secrets, but should become environment-scoped and provider-domain-restricted.
- POS calls a `setup-reader` action that the current `stripe-terminal` function does not implement.
- POS writes display-formatted `visitDate`, while admin "today" logic expects ISO date strings.

Recommended first QA/security gates:

1. Keep and extend unit tests around canonical pricing, order creation, webhook idempotency, role checks, and XSS escaping.
2. Extend the route smoke script into Playwright desktop/mobile checks for screenshots, console errors, and reduced motion.
3. Keep dependency audit, CodeQL, Dependabot, and tracked artifact/secret scanning wired into CI.
4. Harden GitHub dashboard settings: protect `main`, require PRs, require CI and Vercel preview, block force pushes/deletions, and confirm vulnerability alerts.
5. Track the POS `setup-reader` mismatch and date-format bug before POS rebuild or shutdown.
