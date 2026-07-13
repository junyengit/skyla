# Skyla Modernization Plan (Historical)

Last updated: 2026-07-07

This is the original staged modernization plan, retained for decision history.
It is not an operator runbook or current architecture authority. Use
[current-state-simple.md](current-state-simple.md), the
[owner dashboard checklist](runbooks/owner-dashboard-checklist.md),
[ADR 0032](decisions/0032-ledgered-supabase-convex-migration.md) for the narrow
ledgered data migration, and
[ADR 0034](decisions/0034-clerk-convex-staff-auth.md) for human staff auth.
Where this plan proposes broader imports, Kaskade work, static compatibility
pages, or pre-Clerk staff access, those items are superseded.

## Objective

Move Skyla from a flat GitHub Pages static site with Supabase-era operational code into a modern, secure, maintainable Turborepo architecture on Vercel, using the latest verified core versions:

- Next.js `16.2.10`
- React `19.2.7`
- Motion `12.42.2`
- Turborepo `2.10.5`
- TypeScript `6.0.3`

The migration is intentionally in-place and staged. Production rollback is now
handled with Vercel deployments while the deeper Convex, payment, admin, and
POS work continues.

## Current State

Skyla's public domain has been moved to Vercel DNS and Vercel reports both
`skydeckla.com` and `www.skydeckla.com` as configured correctly. The Vercel
production deployment is ready and route-compatible. Custom-domain smoke tests
now pass for both apex and `www` without DNS overrides. Root GitHub Pages static
files have been removed from the active tree, and GitHub Pages is disabled after
Vercel custom-domain verification. Use Vercel deployment rollback for hosting
rollback.

The Vercel/Turborepo foundation has been merged to `main`. Vercel project `junyen-enterprises/web` deploys `apps/web`, and the custom domains are attached in Vercel.

Historical backend/data dependencies from the original static/Supabase app:

- Browser data facade in `shared-data.js`
- Supabase Auth for admin/POS
- Supabase tables implied by code: `bookings`, `members`, `inquiries`, `config`
- Supabase Edge Functions under `supabase/functions`
- Stripe Checkout, Payment Element, Terminal, and webhooks
- Kaskade/PharosGate crypto payment actions and webhook (historical and now
  retired; there is no active replacement workstream)
- EmailJS/Brevo confirmation emails
- Meta Pixel and planned Google Ads conversion tracking

Current runtime state is tracked in [current-state-simple.md](current-state-simple.md)
and [migration-progress.md](migration-progress.md). In short: the app now ships
from `apps/web` on Vercel, root legacy static files are gone, native public,
checkout, admin, and POS routes are in the Next.js App Router, and old
Supabase payment functions in this repo are fail-closed retired stubs. Convex,
Stripe Checkout, Stripe webhook, and Stripe Terminal code paths exist, but live
payment acceptance remains dashboard-gated until Convex, Vercel envs, Stripe
webhooks, staff seeding, and test-reader acceptance are completed.

Resolved foundation gaps:

- Repo-level README, runbooks, CI, package manifest, lockfile, Turborepo config, and initial Vercel project setup now exist on `main`.
- Sensitive local artifact paths such as `output/` and `tmp/` are ignored and must stay out of Git and Vercel.

Remaining operating gaps:

- Convex/Vercel envs, staff seeding, Stripe dashboard webhooks, and Stripe
  Terminal test-reader acceptance still need dashboard completion before live
  card or reader payment acceptance.
- Supabase dashboard retirement must be confirmed by disabling or redeploying
  old Edge Functions and proving Stripe no longer points to Supabase endpoints.
- Dependabot vulnerability alerts, automated security fixes, CodeQL,
  CODEOWNERS, branch protection, and baseline security scripts are present.
  Secret scanning should still be confirmed in the GitHub Security dashboard.
- Legacy Supabase deployment surfaces should be disabled or redeployed to the
  repo's HTTP-410 retired stubs after Convex/Stripe acceptance passes.

## Target Architecture

```text
skyla/
  apps/
    web/                  # Vercel project root, Next.js App Router
      app/                # Public site, checkout, admin, POS routes
      components/         # App-specific components and client islands
      lib/                # App server/client helpers
      public/             # Deployable static assets
  packages/
    config/               # Typed business/site constants
    ui/                   # Shared UI primitives and icons
    data/                 # Future Convex-facing data contracts
    payments/             # Future payment order contracts
  docs/
    migration-plan.md
    migration-progress.md
    architecture.md
    environment.md
    runbooks/
  scripts/
    invoices/             # Sanitized reusable invoice scripts only, if retained
  convex/                 # Future Convex schema/functions/actions
```

The final app should use:

- Vercel Git integration with Preview Deployments for every PR.
- Vercel project root set to `apps/web`.
- `turbo build` for monorepo builds.
- Next.js App Router with server components by default and small client islands for Motion and interactive workflows.
- Convex for canonical data, server-side authorization, payment order state, webhook/event ledgers, admin/POS workflows, and public lead submission.
- Server-authoritative payment creation. The browser may choose products, but server code calculates and stores the order amount.

## Execution Phases

### Phase 0: Containment

Status: complete for foundation; continue monitoring

- Ignore local/generated/sensitive artifacts: `output/`, `tmp/`, logs, build outputs, local env files.
- Keep these artifacts out of Vercel and GitHub.
- Audit whether any sensitive artifacts were ever committed or publicly deployed.
- Decide whether invoice scripts are productized; if so, move sanitized scripts to `scripts/invoices`.

### Phase 1: Monorepo Foundation

Status: complete

- Add root `package.json`, `bun.lock`, `turbo.json`, and `tsconfig.base.json`.
- Add `apps/web` as the Next.js/Vercel application.
- Add `packages/config` and `packages/ui` as the first shared packages.
- Copy current static assets into `apps/web/public/images`.
- Add CI for install, lint, typecheck, and build.
- Remove duplicate root static files after Vercel custom-domain cutover is verified.

### Phase 2: Documentation And Runbooks

Status: current for foundation and cutover; expand as Convex/payments/admin work lands

- Add `README.md` with project map and quickstart.
- Add architecture docs for current and target systems.
- Add environment docs with public vs secret variables.
- Add runbooks for local development, Vercel deploys, GitHub workflow, payment validation, domain cutover, rollback, and incident response.
- Add release checklist and migration progress tracker.

### Phase 3: Public Site Rebuild

Status: in progress

- Rebuild the public homepage in Next.js with current brand assets.
- Migrate About, Cafe, Experiences, Members, Privacy, and Terms into typed routes.
- Temporary state: Vercel bridges existing public routes to static compatibility pages in `apps/web/public` so DNS cutover does not create 404s while full App Router pages are rebuilt.
- Use Motion sparingly for purposeful transitions, respecting reduced motion.
- Keep SEO metadata, structured data, sitemap, and robots behavior in Next-native form.
- Add `noindex` for admin and POS routes.

### Phase 4: Secure Data And Payment Boundary

Status: code largely shipped; live acceptance dashboard-gated

- Server-side checkout and POS draft models exist and calculate canonical
  pricing before payment.
- Stripe Checkout and Stripe Terminal actions create provider payments from
  stored orders/sales instead of browser totals.
- Webhooks validate order/sale refs, provider IDs, expected amounts, currency,
  status, and idempotency before recording payment state.
- Payment and webhook event ledgers exist in Convex.
- Live acceptance still requires Convex deployment/env linking, Stripe webhook
  dashboard setup, seeded staff users, and controlled test-mode acceptance.

### Phase 5: Convex Migration

Status: schema/functions shipped; cloud deployment and data import gated

Target Convex tables:

- `bookings`
- `members`
- `inquiries`
- `config`
- `orders`
- `paymentEvents`
- `webhookEvents`
- `staffUsers` or auth role mapping

Initial indexes:

- `bookings.by_bookingRef`
- `bookings.by_visitDate_status`
- `bookings.by_createdAt`
- `bookings.by_emailLower`
- `orders.by_orderRef`
- `orders.by_status_createdAt`
- `paymentEvents.by_provider_providerPaymentId`
- `webhookEvents.by_provider_providerEventId`
- `members.by_status_createdAt`
- `inquiries.by_status_createdAt`
- `config.by_key`

The original migration steps in this phase are superseded by ADR 0032. The
accepted migration imports only `bookings`, `members`, and `inquiries`; it
excludes config, Supabase Auth/passwords, orders, POS sales, and all financial
ledgers. It uses immutable exports, SHA-256 manifests, quarantine,
development-first apply, reconciliation, and per-batch rollback. Stripe
webhooks move to Convex during payment acceptance. Kaskade is retired and must
not be ported or configured.

### Phase 6: Admin And POS Rebuild

Status: native routes shipped; live operations gated by Convex/staff setup

- Native `/admin`, `/pos`, and `/pos-next` staff surfaces are in the Next.js
  App Router and keep readable white text on dark staff backgrounds.
- Human staff use Clerk under ADR 0034; the short-lived JWT still uses the
  bearer API transport before protected operations, POS readers, sale drafts,
  or payment handoffs are returned.
- Convex staff roles exist as `admin`, `pos`, and `viewer`.
- Booking/member status actions and POS sale/payment flows write audit/payment
  events where implemented.
- Live use remains blocked until Convex is linked, staff users are seeded, and
  dashboard payment gates are verified.
- Refund/cancellation policy workflows and deeper config/catalog editing are
  future slices.

### Phase 7: Vercel Setup And Domain Cutover

Status: Vercel setup, route verification, Vercel domain verification, and custom-domain smoke tests complete

- [x] Create/link a Vercel project for `apps/web`.
- [x] Set root directory to `apps/web`.
- [x] Use install/build commands compatible with the monorepo:
  - Install: `cd ../.. && bash scripts/setup/vercel-install-bun-canary.sh`
  - Build: `cd ../.. && export PATH="$HOME/.bun/bin:$PATH" && bun --revision && bun run build --filter=@skyla/web`
- [ ] Add production environment variables as migrated server flows require them.
- [x] Deploy preview and production builds.
- [x] Add `skydeckla.com` and `www.skydeckla.com` to the Vercel project.
- [x] Verify Vercel production route compatibility before custom-domain cutover.
- [x] Move GoDaddy nameservers to Vercel DNS and verify both domains in Vercel.
- [x] Re-run custom-domain smoke tests after stale local DNS caches clear.
- Use Vercel deployment rollback for hosting rollback. Do not disable Supabase
  functions/storage until Convex/payment replacements are verified.

### Phase 8: GitHub Hardening

Status: active in repo config and GitHub branch protection

- Protect `main`.
- Require pull requests and strict `ci-build`, `Analyze JavaScript and
  TypeScript`, and `Vercel` checks.
- Block force pushes and branch deletion.
- Enable Dependabot security updates.
- Add CodeQL scanning.
- Add CODEOWNERS and security reporting policy.
- Run tracked artifact and obvious secret scanning in CI.
- Keep secret scanning and push protection enabled.
- Prefer signed commits when possible.
- Use Vercel previews as the review surface.

### Phase 9: Formal Security Review

Status: planned

Run a formal security scan after core migration. Focus areas:

- Payment tampering
- Webhook replay/idempotency
- Staff auth and role bypass
- Stored XSS through booking/member/inquiry/config fields
- Sensitive artifact exposure
- Tracking/privacy compliance
- CDN/script supply chain
- Rate limiting and abuse controls

## Rollout Strategy

1. Land monorepo foundation without changing production domain.
2. Deploy Vercel preview for the new app.
3. Rebuild public routes.
4. Port payment/order flow behind feature flags.
5. Port admin/POS behind authenticated routes.
6. Migrate data to Convex and reconcile.
7. Production domain has been cut over to Vercel.
8. Production smoke tests are confirmed on apex and `www`.
9. Disable old Supabase deployment surfaces only after confirmation.

## Rollback Strategy

- Hosting rollback is Vercel production rollback to the last known-good deployment.
- Backend rollback must preserve legacy Supabase access until Convex/payment cutover is verified.
- Payment backend rollback must preserve order/payment ledgers and avoid double-ticket issuance.
