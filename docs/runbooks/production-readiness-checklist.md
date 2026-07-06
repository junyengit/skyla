# Production Readiness Checklist

This is the simple current-state checklist for Skyla hosting, payments,
dependencies, and the remaining dashboard work.

## Simple Summary

The site is hosted on Vercel and the domain is pointed at Vercel. The public
pages load, and smoke tests pass on both `skydeckla.com` and
`www.skydeckla.com`.

The new safer payment backend is partly built in Convex code: orders and POS
sale drafts can be priced from server-owned data, Stripe Checkout sessions can
be created from a stored `orderRef`, and Stripe webhooks can verify signatures
before marking an order paid. Stripe Terminal PaymentIntents can now be created
from a stored POS `saleRef` only. The primary `/checkout` page now uses the
Next.js App Router and fails closed until the real Convex deployment, Vercel
env vars, and Stripe dashboard webhook endpoint are ready.

The extensionless `/pos` route is now the native server-priced POS shell. The
older `/pos-next` URL still renders that native shell during rollout, and
`/pos.html` is now a compatibility handoff to `/pos`; it no longer loads the
old POS browser app, Stripe Terminal SDK, or shared data facade. The native POS
screen now loads authorized Terminal readers from a staff-gated Convex route
instead of asking staff to type Stripe reader/location IDs. Reader collection is
still locked until staff auth, Convex envs, Stripe webhooks, and Stripe
Terminal test-reader acceptance are complete. Native `/admin` now has a
staff-token operations snapshot plus audited booking/member status actions.
`/admin.html` is now a compatibility handoff to `/admin`; it no longer loads
the old admin browser app or shared data facade. The old
static checkout URL is still reachable at `/checkout.html`, but it is now only
a compatibility handoff to `/checkout`; the old browser checkout script and
stylesheet are no longer shipped.

The native `/members` page now uses the server member application API instead
of the legacy localStorage/Supabase write path. It correctly refuses to accept
applications when Convex is not configured, so the page is safe to serve but
real application intake still depends on the dashboard setup below.

The native `/experiences` page now uses the server event inquiry API instead
of the legacy localStorage/Supabase write path. It correctly refuses to accept
event inquiries when Convex is not configured, so the page is safe to serve but
real event intake still depends on the dashboard setup below.

## Plain-English Next Checklist

1. Link the real Skyla Convex project.
2. Add `NEXT_PUBLIC_CONVEX_URL` in Vercel Preview and Production.
3. Add Stripe secrets in Convex, not Vercel browser env vars.
4. Keep Stripe in test mode first.
5. Create the Stripe webhook endpoint after Convex gives you the site URL.
6. Use Stripe test cards and a test Terminal reader only.
7. Keep `SKYLA_POS_TERMINAL_ACCEPTANCE` unset until no-write preflight,
   webhook setup, and reader registry checks pass; then enable it only for the
   controlled test-reader attempt.
8. Add `SKYLA_TERMINAL_READER_REGISTRY` in Convex with no duplicate reader IDs.
9. Seed the first staff admin, then remove the bootstrap token.
10. Confirm `/api/pos/readers` returns readers only with a valid staff token.
11. Run the linked acceptance harness against a Vercel Preview URL.
12. Confirm member and event forms save into Convex in Preview.
13. Confirm checkout and POS stay server-priced with test payments.
14. Disable or redeploy old Supabase payment functions from the fail-closed
    repo copies.
15. Finish the native admin/POS rebuild and test-reader acceptance before
    removing the remaining compatibility handoffs.
16. After each merge, rerun route, payment, readiness, dependency, and CodeQL
    checks and record the production deployment URL here.

## Current Verified State

- Vercel project: `junyen-enterprises/web`
- Vercel project ID: `prj_fhlOjcwSbnPAuLi8tTiGbhjVomnr`
- Most recent full production verification recorded here on 2026-07-06:
  `https://web-4jgzocjsd-junyen-enterprises.vercel.app`
- Evidence deployment ID checked on 2026-07-06:
  `dpl_A9RsQBhPHNxPWKj3e3QPm4G325TS`
- Evidence merge commit checked on 2026-07-06:
  `65bb2a6e38eed1474cf809586ef427b57af9b196` (PR #96).
- PR #96 added `bun run vercel:env:check`, a safe Vercel env presence/scope
  checker that fails until `NEXT_PUBLIC_CONVEX_URL` is present in Preview and
  Production and fails if Stripe/staff/Terminal secrets are placed in Vercel.
- Query Vercel for the newest deployment URL before recording fresh operational
  evidence. Future docs-only merges may create newer URLs with the same app
  behavior.
- Custom domains checked on 2026-07-06:
  - `https://skydeckla.com`
  - `https://www.skydeckla.com`
- Vercel/Convex env behavior checked on 2026-07-06: `vercel env ls` for
  `junyen-enterprises/web` found no project environment variables. Production
  still behaves as Convex-unconfigured, so checkout/POS/member/experience
  server writes and payment execution are safely blocked. `bun run
  vercel:env:check` also failed as expected with `envCount: 0`,
  `readyForConvexUrl: false`, and `safeSecretPlacement: true`.
  `bun run dashboard:readiness` is the combined follow-up check to run after
  Vercel and Convex dashboard edits; it reports the next dashboard actions and
  remains non-zero until linked Preview no-write preflight is shaped.
- DNS TXT records checked by subagent on 2026-07-02: authoritative Vercel DNS
  did not return the older Apple/Brevo TXT values documented in the domain
  runbook. Restore them in Vercel DNS if those services are still needed, or
  update the domain runbook after confirming they are intentionally removed.
- GitHub branch protection checked on 2026-07-02: `main` is protected with
  strict required checks `ci-build`, `Analyze JavaScript and TypeScript`, and
  `Vercel`; force pushes, branch deletion, and unresolved conversations are
  blocked.
- GitHub CodeQL PR check passed on 2026-07-05 for native voucher redemption
  PR #67, POS reader registry selector PR #71, and Supabase checkout retirement
  PR #73, and linked acceptance readiness PR #75. The Code Scanning open-alert
  API returned `404` for the local `gh` token during an earlier docs pass, so
  use the GitHub Security tab to refresh the open-alert count before recording a
  new alert-list audit.
- GitHub security toggles checked on 2026-07-02: Dependabot vulnerability
  alerts are enabled, automated security fixes are enabled, and the repo
  homepage points to `https://skydeckla.com`.
- GitHub Pages was disabled on 2026-07-02 after Vercel custom-domain production
  was verified. The old `https://junyengit.github.io/skyla/` surface should
  stay off unless Vercel rollback is unavailable and a deliberate Pages rollback
  is planned.
- Live API behavior checked on 2026-07-06 across `https://skydeckla.com` with
  `PAYMENT_SMOKE_BASE_URL=https://skydeckla.com bun run test:payments`:
  - Spoofed checkout total `1` cent returned canonical server total `8505`
    cents for the probe payload.
  - Spoofed POS total/reader/location returned canonical server total `9700`
    cents for the probe payload and no reader/location fields in the transient
    draft.
  - `/api/payments/stripe-checkout`,
    `/api/payments/stripe-terminal`, and
    `/api/payments/stripe-terminal/process` returned `503` with
    `convex_unconfigured` when probed with the required fake staff auth where
    applicable.
  - `/api/payments/stripe-terminal` returned `401 staff_auth_required` before
    Convex configuration when no staff token was provided.
  - `/api/pos/readers` returned `401 staff_auth_required` before exposing any
    Terminal reader records.
  - No response exposed a Stripe `clientSecret`.
- Payment code audit on 2026-07-06 found no raw card PAN/CVC collection or
  storage, no public `clientSecret` exposure, and server-owned amount authority
  for Checkout and Terminal payment creation. Route tests now include explicit
  `clientSecret`/`client_secret` regression fixtures for public payment
  responses.
- Legacy Supabase retirement guard: `bun run security:supabase-retired` checks
  all five repo copies of the old Stripe/Kaskade payment and webhook functions.
  They must stay HTTP-410 retired surfaces and must not initialize Supabase
  helpers or call Stripe/Kaskade APIs.
- Native admin export API checked on 2026-07-05 and carried forward after the
  PR #96 smoke pass:
  - `/api/admin/export?kind=bookings` returned `401 staff_auth_required`
    without a bearer token.
  - The same route returned `503 convex_unconfigured` with a fake bearer token
    while the real Convex deployment URL is not configured.
  - Both responses included `Cache-Control: no-store` and `Vary:
    Authorization`.
- Member application and experience inquiry APIs checked on 2026-07-06 across
  the apex and `www` custom domains with `bun run test:production-readiness`:
  both no-write probes remained safely Convex-gated and did not create data.
- Linked acceptance harness: `bun run test:acceptance:linked` exists for the
  first Convex/Vercel/Stripe test-mode Preview after dashboard wiring. It is
  intentionally opt-in, uses the Vercel Preview branch alias by default, refuses
  non-preview targets unless explicitly allowed, asks the deployed backend for a
  staff-gated readiness snapshot, and writes test member, inquiry, checkout, and
  POS records only after the operator provides a seeded test staff token.
- Vercel production runtime errors checked on 2026-07-06 after PR #96 and the
  latest smoke probes: no grouped runtime errors in the selected 30-minute
  window and no error/fatal logs for deployment
  `dpl_A9RsQBhPHNxPWKj3e3QPm4G325TS`. Non-200 responses were expected:
  `401` for staff-auth gates and `503` for Convex-unconfigured write/payment
  gates.
- Staff API header probes checked on 2026-07-06: `/api/admin/catalog` and
  `/api/pos/readers` now return `Cache-Control: no-store` and
  `Vary: Authorization` for staff-gated and fail-closed responses.
- Bun checked locally: `1.4.0-canary.1+d37f52067`
- Dependency audit checked on 2026-07-06: `bun audit --audit-level=low`
  reports no vulnerabilities after the `postcss@8.5.16` override.
- Dependency freshness checked on 2026-07-06: `bun outdated` produced no
  upgrade table in this worktree, direct registry checks found the core runtime
  stack current, and `bun update --latest --dry-run` made no manifest or
  lockfile change. ESLint 10 remains intentionally deferred because the current
  Next lint plugin stack still peers against ESLint 9 in key packages.

```mermaid
flowchart TD
  domain["skydeckla.com / www"]
  vercel["Vercel web project"]
  next["apps/web Next.js"]
  checkout["App Router checkout"]
  members["Native /members + member API"]
  experiences["Native /experiences + inquiry API"]
  pos["Native /pos POS draft"]
  handoff["Saved-link .html handoff pages"]
  supabase["Legacy Supabase function stubs"]
  convex["Convex order/payment code"]
  stripe["Stripe dashboard"]

  domain --> vercel --> next --> checkout
  next --> members
  next --> experiences
  next --> pos
  next --> handoff --> next
  checkout -. "needs env" .-> convex
  members -. "needs env" .-> convex
  experiences -. "needs env" .-> convex
  pos -. "needs staff auth" .-> convex
  convex -. "needs env + webhook endpoint" .-> stripe
```

## What Is Good Right Now

- Hosting is on Vercel.
- GoDaddy nameservers are pointed at Vercel.
- Vercel production and both custom domains pass the 23-route smoke test.
- The 23-route smoke test passed on 2026-07-06 for `https://skydeckla.com`
  after PR #96 reached production.
- GitHub `main` is protected with required `ci-build`,
  `Analyze JavaScript and TypeScript`, and `Vercel` checks.
- GitHub CodeQL PR checks are passing; use the GitHub Security tab to refresh
  the open-alert count because the local token may not have Code Scanning API
  access.
- Admin and POS are marked `noindex, nofollow`.
- `/admin`, `/admin.html`, `/pos`, `/pos.html`, and `/pos-next` are marked
  `noindex, nofollow` in the current code path.
- Native `/admin` uses `/api/admin/operations` to request a staff-gated Convex
  operations snapshot; it does not read or write Supabase from the browser.
- Native `/admin` can now call audited booking/member status actions through
  Next API routes and Convex mutations. The browser sends only refs, allowed
  statuses, and the staff bearer token.
- Native `/admin` can now look up a booking reference or exact guest email
  through `/api/admin/bookings/lookup`, then check in or undo check-in through
  the same audited status route. It still fails closed until Convex is linked.
- Native `/admin` can now load and save typed announcement/hours config through
  `/api/admin/config`; pricing, menu, catalog, vouchers, refunds, deletes, and
  resets remain intentionally unavailable.
- Legacy `/admin.html` is now retired to a native handoff. The old
  `admin.js`, `admin.css`, and `shared-data.js` staff browser assets are absent
  from `apps/web/public`, so missing workflows must move into native Convex
  routes instead of reviving browser Supabase writes.
- `/api/members/applications` is the new server-durable member application path.
  It validates applicant fields, requires Convex before accepting, dedupes exact
  retries with an idempotency key, and writes a pending Convex `members` row plus
  a compact audit event.
- Native `/members` posts to that API with an idempotency key and no longer
  writes applications through `SkylaData.addMember`, browser localStorage, or
  the legacy Supabase mirror.
- `/api/experiences/inquiries` is the new server-durable event inquiry path.
  It validates public inquiry fields, requires Convex before accepting, dedupes
  exact retries with an idempotency key, and writes a pending Convex
  `inquiries` row plus a compact audit event.
- Native `/experiences` posts to that API with an idempotency key and no longer
  writes event inquiries through `SkylaData.addInquiry`, browser localStorage,
  or the legacy Supabase mirror.
- Admin and POS dark-theme text is high contrast. Staff compatibility pages
  `/admin.html` and `/pos.html` are self-contained handoffs to the native
  routes, and production readiness checks fail if retired staff assets are
  served again.
- Helium visual QA on 2026-07-05 confirmed live `/admin` and `/pos-next` render
  readable white text on black staff surfaces. This follow-up also keeps
  primary, active, and disabled staff controls white-on-dark in CSS. The
  PR #88 final visual pass used local production screenshots because Helium was
  running with zero visible windows in the desktop session.
- Native `/pos` and compatibility `/pos-next` review a server-calculated POS
  total without using browser totals.
- Native `/pos` loads authorized Stripe Terminal readers through
  `/api/pos/readers`; staff no longer type free-text `tmr_...` or `tml_...`
  values into the sale screen.
- `/api/order-drafts/pos` ignores browser-sent `terminalLocationId`. Convex
  derives any stored Terminal location from `SKYLA_TERMINAL_READER_REGISTRY`.
- Legacy `/pos.html` is now retired to a native handoff. The repo copy of the
  old Supabase Terminal function returns `410` for `setup-reader` as well as
  the old charge/reader bridge actions.
- `/api/payments/stripe-terminal` accepts only `saleRef` and `idempotencyKey`,
  requires a staff bearer token, and forwards to Convex.
- Convex Stripe actions now require `SKYLA_STRIPE_MODE`, and they reject a
  Stripe secret key whose `sk_test_` or `sk_live_` prefix does not match it.
- Convex Stripe webhooks now reject events whose `livemode` flag does not match
  `SKYLA_STRIPE_MODE`.
- The POS Terminal reader handoff uses the stored sale/reader, requires the
  Convex `SKYLA_TERMINAL_READER_REGISTRY`, and keeps the sale pending until
  Stripe final confirmation.
- Stored readers are rechecked against the registry at payment time, and
  duplicate in-flight reader handoffs are rejected by a short reservation lock.
- Production `/api/payments/stripe-checkout` currently fails closed with
  `convex_unconfigured` until Convex is connected. Terminal payment routes
  require staff bearer auth first, then fail closed with `convex_unconfigured`
  until Convex is connected.
- `bun run test:payments` now checks the payment API fail-closed behavior on
  any supplied base URL without using a real card or writing Convex data.
- `bun run test:production-readiness` now bundles route, noindex, payment
  no-write, member no-write, experience inquiry no-write, and staff
  compatibility handoff checks for the custom domains.
- `/api/admin/bookings/status` and `/api/admin/members/status` require staff
  bearer auth first, fail closed when Convex is unconfigured, reject arbitrary
  statuses before calling Convex, and do not expose Stripe `clientSecret`.
- `/api/admin/acceptance-readiness` requires staff bearer auth first, fails
  closed when Convex is unconfigured, and returns only safe readiness booleans
  and mode labels for linked Preview acceptance.
- Production `/api/order-drafts/pos` ignores spoofed browser totals and returns
  the server catalog total.
- The repo copy of legacy Supabase Stripe Checkout now returns `410`
  permanently for every non-OPTIONS request; it cannot create payments or
  verify old Stripe Checkout sessions. Legacy Terminal payment creation and
  Stripe webhook handling also return `410` permanently.
- The checkout compatibility handoff no longer ships Kaskade/crypto or the old
  browser checkout script, and the repo copy of legacy Supabase Kaskade
  payment/webhook functions now returns `410` permanently.
- `/checkout.html` now points to `/checkout` and no longer serves legacy Stripe
  card creation code from browser totals.
- Public `.html` compatibility pages for `/about`, `/cafe`, `/experiences`,
  `/members`, `/privacy`, and `/terms` now point to the native App Router
  pages and no longer serve old page CSS, shared navigation JS, or third-party
  tracking snippets.
- Public static compatibility-page ticket links now point to `/checkout`, the
  App Router checkout path, instead of `checkout.html`.
- No raw card number/CVC collection was found in the app code.
- No committed Stripe secret key was found.
- Next.js `16.2.10`, React `19.2.7`, Motion `12.42.2`, Turbo `2.10.3`,
  TypeScript `6.0.3`, Vitest `4.1.10`, and Convex `1.42.1` are current for
  this stack.
- `eslint@10.6.0` is intentionally held because the latest available
  `eslint-plugin-react@7.37.5` crashes under ESLint 10 through Next's lint
  config.
- `bun audit` reports no vulnerabilities.

## Still Not Safe To Call Complete

- Vercel currently has no project env vars, so the deployed app behaves as
  though Convex is unconfigured and live checkout/POS payment execution remains
  intentionally blocked.
- Convex cloud is not linked yet.
- Active Convex `staffUsers` rows are not seeded yet. Native staff auth cannot
  be accepted until at least one admin is seeded.
- Stripe live/test webhook endpoint is not created in the Stripe dashboard yet.
- `/checkout` is the new App Router checkout, but live card payment is gated
  until Convex and Stripe dashboard envs exist.
- `/members` is native, but live application acceptance is still gated until
  `/api/members/applications` can write to a linked Convex deployment in preview
  and production.
- `/experiences` is native, but live event inquiry acceptance is still gated
  until `/api/experiences/inquiries` can write to a linked Convex deployment in
  preview and production.
- `/about`, `/cafe`, `/privacy`, and `/terms` are native App Router pages with
  `.html` compatibility URLs. Native `/cafe` uses the shared
  `@skyla/payments` catalog for public menu prices.
- Any already deployed Supabase payment functions must still be disabled or
  redeployed from the permanently fail-closed repo code in the Supabase
  dashboard. Check `stripe-checkout`, `stripe-terminal`, `stripe-webhook`,
  `kaskade-payment`, and `kaskade-webhook`; `stripe-checkout` should not create
  payments or verify old Checkout sessions. After dashboard changes, run
  `bun run test:supabase-retired:live` against the Supabase functions base URL.
- Legacy `/pos.html` reader connection and charge UI should stay disabled while
  the native `/pos` staff-authenticated Terminal flow is accepted.
- Native `/pos` is not safe for live card-present payment yet because reader
  processing and signed webhook reconciliation still need real
  Convex/staff auth/Stripe dashboard envs plus Stripe test-reader acceptance.
- Admin/POS are not fully rebuilt as protected App Router/Convex workflows yet.
  The native `/admin` snapshot, booking lookup/check-in, status actions, and
  announcement/hours config are the first admin slices; voucher redemption now
  uses the native event-ledger slice.
- Native admin intentionally does not yet do refunds, hard delete, clear all,
  reset all, pricing/menu edits, or payment catalog changes.
- Supabase functions should not be removed until checkout, POS, admin, and data
  migration acceptance tests pass.

## Dashboard Checklist

### Vercel

- [ ] Confirm project root is `apps/web`.
- [ ] Confirm Production Branch is `main`.
- [ ] After every merge, record the production deployment URL, deployment ID,
      commit SHA, and aliases for `skydeckla.com` and `www.skydeckla.com`.
- [ ] Confirm install command is
  `cd ../.. && bash scripts/setup/vercel-install-bun-canary.sh`.
- [ ] Confirm build command is
  `cd ../.. && export PATH="$HOME/.bun/bin:$PATH" && bun --revision && bun run web:build`.
- [ ] Add `NEXT_PUBLIC_CONVEX_URL` to Preview and Production after Convex is
      linked.
- [ ] Run `PATH="$HOME/.bun/bin:$PATH" bun run vercel:env:check` after adding
      Vercel envs. It should report `readyForConvexUrl: true` and
      `safeSecretPlacement: true`.
- [ ] Run `PATH="$HOME/.bun/bin:$PATH" bun run dashboard:readiness` after
      Vercel and Convex dashboard edits. It should report
      `status: "linked_preflight_ready"` before `bun run test:acceptance:preflight`.
- [ ] Confirm only public browser config is in Vercel. Stripe secrets,
      webhook secrets, staff bootstrap token, and Terminal reader registry
      belong in Convex, not `NEXT_PUBLIC_*`.
- [ ] Add Google Ads public env vars only when ads are ready.
- [ ] Keep secrets out of `NEXT_PUBLIC_*`.
- [ ] Confirm `/pos` and `/pos-next` remain `X-Robots-Tag: noindex, nofollow`
      after every preview and production deploy.
- [ ] Confirm `/admin` and `/admin.html` remain `X-Robots-Tag: noindex,
      nofollow` after every preview and production deploy.
- [ ] Confirm `/admin.html` and `/pos.html` are handoff-only pages that preserve
      query/hash, point to `/admin` and `/pos`, and do not serve the retired
      `admin.js`, `pos.js`, or `shared-data.js` assets.
- [ ] In Vercel DNS, confirm required TXT records still exist for Apple/Brevo or
      other external services. The 2026-07-02 live check did not see the older
      Apple/Brevo TXT values.

### Convex

- [ ] Create or link the Skyla Convex project.
- [ ] Run real project codegen, not anonymous local mode.
- [ ] Set `SKYLA_STRIPE_MODE` to `test` for Preview/test acceptance. Use `live`
      only after test cards, test webhooks, and test reader acceptance pass.
- [ ] Set `STRIPE_SECRET_KEY` in Convex test/preview first.
- [ ] Set `SKYLA_PAYMENT_RETURN_ORIGINS` to
  `https://skydeckla.com,https://www.skydeckla.com`.
- [ ] Set `STRIPE_WEBHOOK_SECRET` after creating the Stripe endpoint.
- [ ] Set `SKYLA_TERMINAL_READER_REGISTRY` with the Stripe test-reader IDs and
      locations that staff are allowed to use.
- [ ] Keep `SKYLA_POS_TERMINAL_ACCEPTANCE` unset until no-write preflight,
      signed webhook setup, and reader registry checks pass. Then set it to
      `enabled` only in the matching Preview/Convex runtime for the controlled
      Stripe test-reader acceptance attempt.
- [ ] Run `bun run convex:env:check`.
- [ ] Before payment acceptance, run
      `SKYLA_CONVEX_ENV_REQUIRE=cloud,stripe-checkout,stripe-webhook bun run convex:env:check`.
- [ ] Before Terminal reader acceptance, run
      `SKYLA_CONVEX_ENV_REQUIRE=cloud,stripe-webhook,terminal-reader bun run convex:env:check`.
- [ ] Run `bun run convex:codegen`.
- [ ] Temporarily set `SKYLA_STAFF_BOOTSTRAP_TOKEN`, run
      `staffBootstrap.upsertStaffUser` for the initial admin, then remove the
      token.
- [ ] Seed active `staffUsers` records for admins/viewers/POS staff before
      using native `/admin`, `/pos`, or `/pos-next`.
- [ ] Verify `/api/admin/operations` returns `200` with a valid staff token and
      `401`/`503` without auth or envs.
- [ ] Verify `/api/admin/bookings/status` returns `200` with a valid admin/pos
      token for `confirmed` and `checked-in`, rejects arbitrary statuses with
      `400`, and returns `503` while Convex is unconfigured.
- [ ] Verify `/api/admin/bookings/status` allows `cancelled` only for `admin`
      staff and writes an `admin.bookingStatus.update` audit event.
- [ ] Verify `/api/admin/members/status` allows only `admin` staff, accepts
      `pending`, `approved`, `waitlisted`, and `rejected`, and writes an
      `admin.memberStatus.update` audit event.
- [ ] Verify `/api/admin/config` can load and save announcement/hours with a
      valid admin token, rejects viewer/pos writes, rejects malformed shapes,
      and writes an `admin.config.update` audit event.
- [ ] Verify `/api/admin/acceptance-readiness` returns `401` without a bearer
      token, then `200` with a valid admin/pos token and `stripe.mode: "test"`.
- [ ] Verify `/api/members/applications` returns `503 convex_unconfigured`
      before env wiring, then returns `201` for a new preview application,
      `200` for an exact idempotent retry, and `409` for a conflicting retry.
- [ ] Verify the created member appears in native `/admin` with name, email,
      phone, source, tier, bio, pending status, and timestamps.
- [ ] Run the no-write linked acceptance preflight against the Vercel Preview
      URL after staff is seeded:

  ```bash
  ACCEPTANCE_BASE_URL="$VERCEL_PREVIEW_BRANCH_ALIAS" \
  SKYLA_ACCEPTANCE_MODE=linked-test \
  SKYLA_ACCEPTANCE_STRIPE_MODE=test \
  SKYLA_ACCEPTANCE_NO_REAL_CARDS=1 \
  SKYLA_STAFF_TEST_TOKEN="$STAFF_TEST_TOKEN" \
  bun run test:acceptance:preflight
  ```

  This checks staff auth, remote readiness, reader gating, and client-secret
  redaction without creating Convex records.
- [ ] Run linked acceptance against the Vercel Preview URL after staff is seeded:

  ```bash
  ACCEPTANCE_BASE_URL="$VERCEL_PREVIEW_BRANCH_ALIAS" \
  SKYLA_ACCEPTANCE_MODE=linked-test \
  SKYLA_ACCEPTANCE_STRIPE_MODE=test \
  SKYLA_ACCEPTANCE_NO_REAL_CARDS=1 \
  SKYLA_STAFF_TEST_TOKEN="$STAFF_TEST_TOKEN" \
  bun run test:acceptance:linked
  ```

  This creates test records in Convex. Use the
  `web-git-<branch>-junyen-enterprises.vercel.app` Preview branch alias first,
  not `skydeckla.com`, unless you deliberately set
  `SKYLA_ALLOW_PRODUCTION_ACCEPTANCE=1`.

### Stripe

- [ ] Record the Stripe mode (`test` or `live`), endpoint ID, endpoint URL,
      subscribed events, and signing-secret rotation date for each webhook
      endpoint.
- [ ] Keep this work in Stripe test mode until the preview checkout and POS
      Terminal acceptance tests pass. Do not use a real credit card for this
      migration validation.
- [ ] Confirm the Stripe account has no live webhook endpoint still pointing at
      Supabase payment functions before live traffic is allowed.
- [ ] Confirm the live publishable key is domain-restricted in Stripe where
      available, and that only publishable keys appear in browser code.
- [ ] Create a test-mode webhook endpoint:
  `https://<convex-site-url>/stripe-webhook`.
- [ ] Subscribe it to:
  - `checkout.session.completed`
  - `checkout.session.async_payment_succeeded`
  - `checkout.session.async_payment_failed`
  - `checkout.session.expired`
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
  - `payment_intent.canceled`
- [ ] Copy the endpoint signing secret into Convex as
  `STRIPE_WEBHOOK_SECRET`.
- [ ] Use Stripe test cards only until preview checkout passes.
- [ ] After Convex persistence and staff checks pass, run the linked harness with
      `SKYLA_ACCEPTANCE_STRIPE_CHECKOUT=1` to create a Stripe test-mode Checkout
      Session from the stored `orderRef`. The harness refuses this unless the
      remote readiness snapshot reports Stripe Checkout ready in test mode. Do
      not enter a real card.
- [ ] Verify webhook delivery, duplicate replay behavior, amount mismatch
      rejection, and order/POS sale status transitions before live traffic.
- [ ] Create a separate live-mode endpoint only after test mode passes.
- [ ] Do not use a real credit card during verification. Use Stripe test mode
      cards and Stripe dashboard test webhooks until preview acceptance passes.
- [x] Replace the legacy Terminal create-intent path in repo code with a Convex
      action that accepts `saleRef` only and reads the stored POS sale amount.
- [x] Add signed Stripe Terminal PaymentIntent webhook reconciliation from the
      stored `saleRef`, stored Terminal PaymentIntent ID, amount, currency, and
      webhook event ID.
- [ ] After the no-write preflight, signed Stripe webhook setup, and reader
      registry checks pass in test mode, temporarily set
      `SKYLA_POS_TERMINAL_ACCEPTANCE=enabled` in the matching Preview/Convex
      runtime and wire native `/pos` to collect/process the Convex-created
      PaymentIntent on a real Stripe test reader.
- [ ] Only with a Stripe test reader ready, run the linked harness with
      `SKYLA_ACCEPTANCE_TERMINAL_READER=1` after the base linked acceptance
      checks pass. The harness refuses this unless the remote readiness snapshot
      reports Terminal reader processing ready in test mode.
- [ ] Disable or redeploy legacy Supabase Stripe functions so any live old
      functions inherit the fail-closed behavior.

### Supabase Legacy

- [ ] In the Supabase dashboard, identify the old Skyla project before making
      changes. Record the project ref from the URL or API settings; the live
      function base URL should be
      `https://<project-ref>.supabase.co/functions/v1`.
- [ ] Open Edge Functions and record each function's current deployed/disabled
      status and last deployment time. Do not delete a function until the
      Stripe dashboard and live smoke evidence below prove it is no longer in
      the payment path.
- [ ] In Supabase Edge Functions, confirm whether `stripe-checkout` is deployed.
      It should be disabled or redeployed from the repo copy that returns `410`
      for every non-OPTIONS request, including old Checkout session
      verification.
- [ ] In Supabase Edge Functions, confirm whether `stripe-terminal` is deployed.
      It should be disabled or redeployed from the repo copy that returns `410`
      for browser-authoritative Terminal charges and legacy reader setup.
- [ ] In Supabase Edge Functions, confirm whether `stripe-webhook` is deployed.
      It should be disabled or redeployed from the repo copy that returns `410`.
      Stripe dashboard endpoints should point to Convex, not Supabase, before
      live payment acceptance.
- [ ] In Supabase Edge Functions, confirm whether `kaskade-payment` and
      `kaskade-webhook` are deployed. They should be disabled or redeployed from
      the repo copies that return `410`.
- [ ] Choose one retirement posture per function:
      disabled `404`, or redeployed retired `410`. Prefer redeployed `410` while
      cutover confidence is still being gathered because it gives explicit
      evidence that old clients hit a retired surface.
- [ ] In the Stripe dashboard, confirm webhook endpoints no longer point to
      `https://<project-ref>.supabase.co/functions/v1/stripe-webhook` or any
      other Supabase function URL. Stripe should point to the Convex HTTP
      webhook URL for the active environment before live payment acceptance.
- [ ] In the Stripe dashboard, confirm no Terminal or Checkout integration notes
      still reference Supabase function URLs. Record the dashboard path checked
      and the date in this checklist or the migration progress log.
- [ ] In Stripe Workbench, confirm the active account and webhook endpoint API
      version plan. The code currently sends `Stripe-Version:
      2026-02-25.clover`; Stripe documents `2026-06-24.dahlia` as current, but
      upgrading across named releases should be a controlled change with
      webhook endpoint version alignment and linked acceptance evidence.
- [ ] Run the live retirement smoke after dashboard changes:

  ```bash
  PATH="$HOME/.bun/bin:$PATH" \
  SKYLA_SUPABASE_RETIREMENT_BASE_URL=https://<project-ref>.supabase.co/functions/v1 \
  SKYLA_SUPABASE_RETIREMENT_LIVE=1 \
  SKYLA_SUPABASE_RETIREMENT_ANON_KEY=<anon-key-if-functions-require-jwt> \
  bun run test:supabase-retired:live
  ```

  Passing means every probed legacy function returned retired `410` with the
  expected repo marker. Disabled `404` only passes with
  `SKYLA_SUPABASE_RETIREMENT_ALLOW_DISABLED=1` after confirming the project and
  function names in Supabase. `401`/`403` is inconclusive, because an active
  function may still process requests when called with credentials. The Terminal
  probe uses `action: "__skyla_retirement_probe__"` so it does not ask the old
  bridge to create a PaymentIntent, reader setup, or connection token.
- [ ] Record the deployed status, last deployment time, and rollback decision
      for each legacy function before deleting anything.

### GitHub

- [x] Protect `main`.
- [x] Require PRs.
- [x] Require strict `ci-build`, `Analyze JavaScript and TypeScript`, and
      `Vercel` checks.
- [x] Block force pushes and branch deletion.
- [x] Require conversation resolution before merge.
- [x] Keep Dependabot vulnerability alerts enabled.
- [x] Keep Dependabot automated security fixes enabled.
- [ ] Confirm secret scanning/secret protection in GitHub's Security dashboard.
- [x] Disable the old GitHub Pages deployment after Vercel cutover verification.

Current check: `main` protection is active through GitHub branch protection.
The CI job is named `ci-build` so it cannot be confused with other GitHub or
hosting integration checks named `build`. GitHub Pages is no longer an active
deployment surface for this repo.

## Verification Commands

```bash
PATH="$HOME/.bun/bin:$PATH" bun install --frozen-lockfile
PATH="$HOME/.bun/bin:$PATH" bun run check
PATH="$HOME/.bun/bin:$PATH" bun run security:audit
PATH="$HOME/.bun/bin:$PATH" bun audit --audit-level=low
PATH="$HOME/.bun/bin:$PATH" bun outdated --recursive
PATH="$HOME/.bun/bin:$PATH" bun run convex:env:check
PATH="$HOME/.bun/bin:$PATH" SMOKE_BASE_URL=<latest-production-url> bun run test:smoke
PATH="$HOME/.bun/bin:$PATH" SMOKE_BASE_URL=https://skydeckla.com bun run test:smoke
PATH="$HOME/.bun/bin:$PATH" SMOKE_BASE_URL=https://www.skydeckla.com bun run test:smoke
PATH="$HOME/.bun/bin:$PATH" PAYMENT_SMOKE_BASE_URL=<latest-production-url> bun run test:payments
PATH="$HOME/.bun/bin:$PATH" PAYMENT_SMOKE_BASE_URL=https://skydeckla.com bun run test:payments
PATH="$HOME/.bun/bin:$PATH" PAYMENT_SMOKE_BASE_URL=https://www.skydeckla.com bun run test:payments
PATH="$HOME/.bun/bin:$PATH" PRODUCTION_READINESS_BASE_URLS=<latest-production-url>,https://skydeckla.com,https://www.skydeckla.com bun run test:production-readiness
PATH="$HOME/.bun/bin:$PATH" SKYLA_SUPABASE_RETIREMENT_BASE_URL=https://<project-ref>.supabase.co/functions/v1 SKYLA_SUPABASE_RETIREMENT_LIVE=1 bun run test:supabase-retired:live
PATH="$HOME/.bun/bin:$PATH" bunx vitest run apps/web/member-applications-route.test.ts convex/memberApplications.test.ts
```

`bun run convex:env:check` is expected to fail until the real Convex/Vercel
environment variables are present. Treat that failure as the dashboard setup
check, not as a reason to bypass the fail-closed payment behavior.

The production-readiness smoke is safe before and after dashboard wiring because
its payment probes are no-write by default: draft routes omit idempotency/auth
write prerequisites, and payment execution routes stop at validation or missing
staff auth before any Stripe action can run. It checks the route matrix, noindex
headers, server-owned totals, checkout handoff/retired asset checks, the native
POS no-legacy check, the member application no-write gate, the experience
inquiry no-write gate, and staff handoff/retired asset checks across the custom
domains plus an optional `VERCEL_PRODUCTION_URL`.

Current dependency note:

- `bun audit --audit-level=low` reports no vulnerabilities.
- `vitest` is patched to `4.1.10`.
- `bun outdated --recursive` reports only a major ESLint update (`9.39.4` to
  `10.6.0`) in `@skyla/web`. I retested that upgrade on 2026-07-06; lint fails
  because `eslint-plugin-react@7.37.5` is not compatible with ESLint 10 through
  the current Next lint stack. Keep ESLint on `9.39.4` until the upstream lint
  plugin stack supports ESLint 10.
- The public homepage, checkout, admin, POS, and cafe display prices now route
  through `@skyla/payments` catalog helpers. Admin still shows this as a
  code-owned read-only catalog. Convex now has catalog versioning, immutable
  product snapshots, and an audited activation/rollback path, but the runtime
  checkout/POS catalog remains code-owned until linked Convex acceptance passes.

## Next Work Order

1. Link real Convex cloud and set Vercel `NEXT_PUBLIC_CONVEX_URL`.
2. Seed initial staff with `staffBootstrap.upsertStaffUser`, verify native
   `/admin`, then remove `SKYLA_STAFF_BOOTSTRAP_TOKEN`.
3. Seed the code-owned catalog with `POST /api/admin/catalog` and verify
   `GET /api/admin/catalog` reports an active version before any future price
   edit work.
4. Verify native `/members` applications persist through
   `/api/members/applications` in preview and production after Convex is linked.
5. Verify preview checkout draft persistence returns `persisted: true`.
6. Create Stripe test webhook endpoint and set Convex Stripe env vars.
7. Set Convex/Vercel env vars so the App Router checkout can persist orders
   and start Stripe Checkout.
8. Add real Vercel/Convex envs, then accept native `/pos` Terminal reader processing on a
   Stripe test reader using stored `saleRef` and stored reader IDs.
9. Accept Stripe Terminal final webhook reconciliation in test mode with a real
   test reader and matching Convex sale.
10. Allow staff to use native `/pos` for card-present payment only after
   Terminal capture uses stored `saleRef` totals and signed webhooks reconcile
   final state.
11. Finish native Admin beyond lookup/status/config/voucher/export actions:
   refunds, catalog/pricing edits, and any destructive action with typed
   validators, audit logs, and rollback steps.
12. Rebuild POS as the protected live App Router/Convex register.
13. Migrate remaining Supabase data and disable legacy Supabase functions only
   after acceptance tests pass.

## Plain-English Handoff

What has been done:

- The website is on Vercel and the domain is pointing there.
- The repo is organized as a Turborepo with the app under `apps/web`.
- Checkout and POS totals are now calculated by trusted code, not by whatever
  the browser sends.
- The current live site does not have the secret Convex/Stripe settings yet, so
  card-payment APIs stop safely instead of trying to charge.
- Stripe mode is now an explicit setting, so test keys/webhooks and live
  keys/webhooks cannot be mixed silently.
- There is now a repeatable payment smoke command to check that fail-closed
  behavior on the Vercel URL, `skydeckla.com`, and `www.skydeckla.com`.
- There is also a one-command production-readiness smoke that bundles route,
  payment no-write, member no-write, experience inquiry no-write, and staff
  compatibility handoff checks.
- `/members` is now a Next.js page. Its form does not save locally; it only
  succeeds after the server accepts the application.
- Admin, native POS, `/pos-next`, and staff compatibility handoffs use
  high-contrast dark staff screens.
- `/admin` is being moved into Next.js. It now has staff-gated operations,
  booking/member status buttons, announcement/hours config, and voucher
  redemption code. It also has admin-only CSV exports for bookings, members,
  inquiries, orders, POS sales, and payments. Those exports use fixed columns,
  no-store responses, formula-safe cells, and masked payment/Terminal IDs.
  `/admin.html` now hands off to the native route.
- `/pos` is now the native server-priced POS screen. `/pos.html` now hands off
  to the native route while Stripe Terminal test-reader acceptance is completed.
  The old reader setup bridge is retired in repo code too.

What still needs to be done:

- Link the real Convex cloud project.
- Add the required Vercel and Convex environment variables.
- Test the native `/members` application form in preview after Convex is linked.
- Create the Stripe webhook endpoint in the Stripe dashboard.
- Test checkout with Stripe test cards only.
- Test native `/pos` Terminal with a Stripe test reader only.
- Finish the protected Admin and POS Next.js/Convex pages for refunds,
  catalog/pricing edits, destructive admin actions, and live Terminal
  acceptance, then disable old Supabase functions after dashboard acceptance.
- Use Stripe test cards and a Stripe test Terminal reader first. Do not verify
  this migration with a real credit card.
