# Skyla Migration Progress

This file is the durable scratchpad for the migration. Update it whenever a task starts, finishes, or is deferred.

## Completed Foundation Goal

Finish the Vercel/Turborepo/Next.js foundation, keep the legacy static site recoverable, make the Vercel production deployment route-compatible with current public paths, then cut over `skydeckla.com` only after verification.

## Active Phase 2 Goal

Clean and reorganize the repository around the new Turborepo architecture, adopt Bun canary deliberately, migrate functionality into Next.js and Convex, make docs useful for humans and agents, add meaningful QA/security coverage, and ship through reviewed PRs.

## Current Status

- [x] Removed customer-visible migration and infrastructure status language
      from Checkout, Members, Experiences, and Privacy. Public fallback messages
      now explain what a guest can do next without exposing Convex, dashboard,
      App Router, or legacy-storage details; route tests guard that boundary.
- [x] Removed raw pasted staff-token controls from the Admin and POS UI on the
      production App Router surfaces.
- [x] Added route-scoped Clerk v7 staff sign-in. The shared `staffFetch`
      wrapper requests a short-lived `convex` JWT for each protected call;
      `staffUsers` and `requireStaffUser` remain Convex role authority, and the
      bearer API contract remains available for automation.
- [x] Passed the current main gate with 126 web tests, 143 Convex tests, 39 script
      tests, lint, all typechecks, the Next production build, artifact and
      legacy-retirement guards, frozen Bun install, and a low-threshold audit
      with no vulnerabilities. Headless desktop/mobile QA found no overflow,
      framework overlay, or console errors and confirmed white text on the
      black Admin/POS surfaces; a fresh Helium pass remains pending while macOS
      is locked.
- [x] Merged Clerk staff-auth PR #121 as
      `fc7a497358b573563d9f0772d3728c4bc853c562` after CI, CodeQL, Vercel,
      correctness, and security review passed.
- [x] Merged public-copy cleanup PR #125 as
      `c6a13e5bdba0e3410aa2657cd6c3889c35013228` after CI, CodeQL, Vercel,
      production-build, desktop/mobile visual, and no-write Preview review.
- [x] Verified READY production deployment
      `https://web-k4sx362fp-junyen-enterprises.vercel.app`
      (`dpl_8a3zSvT4o9XT3rRjukd44magVr41`). Apex and `www` serve the same
      deployment ID; production-readiness and payment smokes passed on all
      three bases, and Vercel returned no error/fatal logs in the checked
      post-merge window.
- [ ] Configure `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and
      `NEXT_PUBLIC_CONVEX_URL` in Vercel Preview/Production; configure
      `CLERK_JWT_ISSUER_DOMAIN` in Convex; deploy the auth config; bootstrap the
      first `staffUsers` row with a Clerk user ID as `subject`; remove the
      bootstrap token; and complete linked Preview acceptance. Production must
      remain fail closed until those steps pass.
- [x] Added signed Stripe refund parsing for `refund.created`,
      `refund.updated`, and `refund.failed` with sanitized provider data.
- [x] Added a normalized Convex refund ledger correlated to the paid Checkout or
      Terminal PaymentIntent, plus identity, amount, currency, cumulative-total,
      stale-event, and final-state guards.
- [x] Added read-only refund rows to native Admin Payments without refund or
      automatic booking-cancellation actions.
- [x] Added focused refund parser, mutation, projection, API, and UI tests.
- [ ] Deploy and accept this refund slice in linked Convex/Stripe test mode,
      after verifying older paid ledger rows have PaymentIntent linkage.
- [x] Merged refund-reconciliation PR #119 as
      `eabd40aeaf34f51e8c8c7bcb92d8f6aad48d77a8` after CI, CodeQL, Vercel,
      payment/data review, and security review passed.
- [x] Verified READY production deployment
      `https://web-mjicopj2r-junyen-enterprises.vercel.app`
      (`dpl_D4wmWoj1x1tUYsy7fnfT2gqJnT6G`).
- [x] Passed no-write production readiness and payment smokes on apex, `www`,
      and immutable production; no real charge occurred and Vercel reported no
      runtime error clusters or error/fatal logs in the checked 30-minute window.

- [x] Recorded the initial GitHub Pages-from-`main` production baseline before
      the Vercel cutover; GitHub Pages is now disabled.
- [x] Verified latest package baseline through npm registry:
  - Next.js `16.2.10`
  - React `19.2.7`
  - Motion `12.42.2`
  - Turbo `2.10.4`
  - TypeScript `6.0.3`
- [x] Added `.gitignore` protection for generated/private artifacts.
- [x] Added root Turborepo workspace files.
- [x] Added `apps/web` Next.js scaffold.
- [x] Added `packages/config` and `packages/ui`.
- [x] Copied images into `apps/web/public/images`.
- [x] Added initial CI workflow.
- [x] Wrote comprehensive migration plan.
- [x] Added README and runbooks.
- [x] Installed dependencies and generated `pnpm-lock.yaml`.
- [x] Fixed build/type/lint issues.
- [x] Ran `pnpm check`: lint, typecheck, shared package builds, and Next.js production build all passed.
- [x] Incorporated Vercel/domain research into runbooks.
- [x] Opened the local Next app in Helium at `http://127.0.0.1:3000`; dev server returned `GET / 200`.
- [x] Reviewed subagent findings and fixed clean-checkout package exports, Node pinning, TypeScript artifact ignores, Vercel command clarity, GitHub Pages merge risk, and Turbo task ordering.
- [x] Created Vercel project `junyen-enterprises/web` for `apps/web` with project ID `prj_fhlOjcwSbnPAuLi8tTiGbhjVomnr`.
- [x] Deployed first Vercel build: `https://web-fwlmziond-junyen-enterprises.vercel.app` (`dpl_DE5YnDKHuuZ4rNcFewuCLYWAeCjH`, READY).
- [x] Opened the Vercel deployment in Helium; homepage rendered successfully.
- [x] Verified clean Git-triggered Vercel deployment: `https://web-h6lacs7d4-junyen-enterprises.vercel.app` (`dpl_4qMAwUAUTPhpmEGmbfW2bfBHFJzu`, READY, branch `codex/next-vercel-turbo-migration`, commit `cbd9b80`).
- [x] Fixed PR review issue in `apps/web/next-env.d.ts` and reran `pnpm check`.
- [x] Merged PR #1 into `main` with merge commit `950ae150ec897afd5457b79ce61c5529142a1edb`.
- [x] Confirmed GitHub CI passed on `main`.
- [x] Confirmed Vercel production deployment from `main` is READY: `https://web-qft9c4zja-junyen-enterprises.vercel.app` (`dpl_5W8dTG9onDxvW8CUwSptKyG3SqFj`).
- [x] Added `skydeckla.com` and `www.skydeckla.com` to the Vercel project.
- [x] Confirmed GoDaddy DNS is still on GitHub Pages and canceled an unsaved DNS edit before route readiness.
- [x] Added Vercel compatibility coverage for legacy public routes and `.html` files in `apps/web/public`.
- [x] Merged route-compatibility PR #2 into `main` with merge commit `f3c99649ea87a9b94e40bdc3e7de35f1ea98e923`.
- [x] Confirmed GitHub CI passed on `main` for `f3c99649ea87a9b94e40bdc3e7de35f1ea98e923`.
- [x] Confirmed Vercel production deployment from `main` is READY: `https://web-istczvmf1-junyen-enterprises.vercel.app` (`dpl_FBG27TbZxzTzfQKgTy4LWaxKF35L`).
- [x] Verified Vercel production route matrix on `https://web-istczvmf1-junyen-enterprises.vercel.app`: `/`, `/index.html`, `/about`, `/about.html`, `/cafe`, `/cafe.html`, `/experiences`, `/experiences.html`, `/checkout`, `/checkout.html`, `/members`, `/members.html`, `/privacy`, `/privacy.html`, `/terms`, `/terms.html`, `/admin`, `/admin.html`, `/pos`, `/pos.html`, `/robots.txt`, and `/sitemap.xml` returned `200`.
- [x] Verified `/admin`, `/admin.html`, `/pos`, and `/pos.html` include `X-Robots-Tag: noindex, nofollow` on the Vercel production URL.
- [x] Confirmed Vercel production URL is publicly reachable without Vercel Authentication.
- [x] Pushed current-state documentation commit `d8da1e3c8ac653f6143aa456debec84069b0ea60` to `main`; GitHub CI and Pages workflow passed.
- [x] Confirmed Vercel production deployment from `main` is READY: `https://web-hc38hldhg-junyen-enterprises.vercel.app` (`dpl_3Q8VU3XvtK4DiiHbkJ9x8p21Wjb5`).
- [x] Confirmed `skydeckla.com` nameservers now resolve to `ns1.vercel-dns.com` and `ns2.vercel-dns.com`.
- [x] Confirmed Vercel domain verification returns `configured_correctly` for both `skydeckla.com` and `www.skydeckla.com`.
- [x] Confirmed direct Vercel-edge requests for `https://skydeckla.com/`, `https://skydeckla.com/checkout`, `https://www.skydeckla.com/`, and `https://www.skydeckla.com/checkout` return `200`.
- [x] Merged Phase 2 roadmap PR #3 into `main` as commit `6891fc5acd444f8ad1c63c0cf90a7740b1a72ff9`; current Vercel production deployment is `https://web-cy8ortmus-junyen-enterprises.vercel.app` (`dpl_CVsRPRSQCoEiMqbhM2FBizvvU13u`, READY).
- [x] Re-ran custom-domain smoke tests without DNS overrides for both `https://skydeckla.com` and `https://www.skydeckla.com`; each 22-route matrix returned `200`, including noindex headers for `/admin`, `/admin.html`, `/pos`, and `/pos.html`.
- [x] Added a QA/security baseline branch with Vitest unit coverage, legacy-route compatibility tests, a live route smoke script, tracked artifact/secret guard, Dependabot, CodeQL, CODEOWNERS, and `SECURITY.md`.
- [x] Merged QA/security baseline PR #4 into `main` as commit `7bfe12a6e3263bab1357b1fd28946873e29642e1`.
- [x] Confirmed post-merge GitHub CI, CodeQL, Dependabot update jobs, and Pages workflow all passed on `main`.
- [x] Confirmed Vercel production deployment from `main` is READY: `https://web-gq0o1xfqu-junyen-enterprises.vercel.app` (`dpl_CUxoYMKy2kxzq3j5kY1M1TNn38um`).
- [x] Re-ran post-merge custom-domain smoke tests without DNS overrides for both `https://skydeckla.com` and `https://www.skydeckla.com`; each 22-route matrix returned `200`.
- [x] Merged workflow dependency PRs for `actions/checkout@v7`, `pnpm/action-setup@v6`, and `actions/setup-node@v6`; latest verified production deployment is `https://web-l7aei5nb9-junyen-enterprises.vercel.app` (`dpl_CU1KmDXUnwRTu7YDjo1BPywv8awp`) from commit `47412f698045adab3b0523b53f829134dd2cf248`.
- [x] Created branch `codex/bun-canary-root-cleanup`.
- [x] Installed Bun canary locally and verified `1.4.0-canary.1+eba370b69`.
- [x] Replaced pnpm workspace metadata with Bun workspace metadata and generated text `bun.lock`.
- [x] Updated GitHub CI to `oven-sh/setup-bun@v2` with `bun-version: canary`.
- [x] Added `apps/web/vercel.json` and `scripts/setup/vercel-install-bun-canary.sh` so Vercel installs/upgrades Bun canary during builds.
- [x] Removed tracked duplicate root static files and root `images/`; active compatibility files remain under `apps/web/public`.
- [x] Verified local Bun gates: `bun install --frozen-lockfile`, `bun run check`, `bun run security:audit`, Vercel install script, and Vercel build command simulation.
- [x] Merged Bun/root-cleanup PR #10 into `main` as merge commit `b321c4b70d13116bfd95b4fa0f4c39bb811f8fcc`.
- [x] Confirmed Vercel production deployment from `main` is READY: `https://web-8rstxz73f-junyen-enterprises.vercel.app` (`dpl_HskCqFwWBx2UNRZevq7KXp89wWHi`).
- [x] Re-ran post-merge custom-domain smoke tests without DNS overrides for both `https://skydeckla.com` and `https://www.skydeckla.com`; each 22-route matrix returned `200`.
- [x] Started branch `codex/ads-pos-convex-prep` from `origin/main` to port useful dirty legacy changes without resurrecting root static files.
- [x] Ported Google Ads conversion tracking into `apps/web/public` with a Vercel env-backed `/ads-config.js` route and tests.
- [x] Moved Google Ads campaign docs/import CSVs under `docs/marketing/google-ads` and kept the security artifact guard narrow.
- [x] Added a guarded `setup-reader` bridge in the legacy Stripe Terminal function requiring `SKYLA_TERMINAL_SETUP_TOKEN`; this bridge was later retired by ADR 0023 on 2026-07-05.
- [x] Merged bridge-hardening PR #12 into `main` as merge commit `07448b6e2a626a4b302056e5a155692ad2a9ba39`.
- [x] Confirmed Vercel production deployment from `main` is READY: `https://web-kham7clfu-junyen-enterprises.vercel.app` (`dpl_69k9h2zKNC7uAGDHzgZmHGT9p6wX`).
- [x] Re-ran post-merge custom-domain smoke tests without DNS overrides for both `https://skydeckla.com` and `https://www.skydeckla.com`; each 22-route matrix returned `200`.
- [x] Verified production browser/console spot checks for `/`, `/checkout.html`, `/experiences.html`, `/members.html`, `/pos.html`, and `/ads-config.js`.
- [x] Started branch `codex/convex-order-spine` from `origin/main` for the first Convex/server-authoritative order slice.
- [x] Added `@skyla/payments` with canonical checkout and POS draft calculations.
- [x] Added `convex/schema.ts` for target products, orders, POS sales, payment/webhook ledgers, promoted legacy records, staff, config, and audit data.
- [x] Added `/api/order-drafts/checkout` to return server-calculated draft totals without creating provider payments.
- [x] Added unit coverage proving browser-supplied totals are ignored and inactive packages are rejected.
- [x] Merged Convex order spine PR #13 into `main` as merge commit `b1272b9112dbde4c83c74b07c8d6204ee98c2960`.
- [x] Confirmed Vercel production deployment from `main` is READY: `https://web-d1efck3u8-junyen-enterprises.vercel.app` (`dpl_FNnfuoY5KbLKG7WceuXuhycp8Q2r`).
- [x] Re-ran post-merge custom-domain smoke tests without DNS overrides for both `https://skydeckla.com` and `https://www.skydeckla.com`; each 22-route matrix returned `200`.
- [x] Verified production `/api/order-drafts/checkout` returns canonical totals and ignores browser-supplied totals.
- [x] Started branch `codex/convex-persist-order-drafts` from clean `main` for persisted Convex checkout/POS draft refs.
- [x] Added committed Convex generated API/server/data-model types from anonymous local Convex validation.
- [x] Added `convex/orderDrafts.ts` with checkout draft persistence, staff-gated POS sale draft persistence, idempotency checks, and read-back queries.
- [x] Added shared record helpers that generate `SKYYYMM-XXXXXX` checkout refs and `SALEYYMMDD-XXXXXX` POS sale refs while omitting undefined fields before writes.
- [x] Added cloud-free Convex helper tests plus `convex:test:unit` and `convex:functions:typecheck` gates.
- [x] Merged persisted Convex draft PR #15 into `main` as merge commit `10b2751099aca72834ff2a33d8d4ccd105cdf3cb`.
- [x] Confirmed Vercel production deployment from `main` is READY: `https://web-j9xi2jyo8-junyen-enterprises.vercel.app` (`dpl_9hS72iV2sQKGYfNgvWCvgworBmao`).
- [x] Re-ran post-merge route smoke tests for `https://web-j9xi2jyo8-junyen-enterprises.vercel.app`, `https://skydeckla.com`, and `https://www.skydeckla.com`; each 22-route matrix returned `200`.
- [x] Verified production `/api/order-drafts/checkout` on `https://skydeckla.com` returns canonical totals and ignores browser-supplied totals after PR #15.
- [x] Verified Vercel project `junyen-enterprises/web` currently has no configured environment variables, so real Convex persistence is still gated on dashboard/env setup.
- [x] Started branch `codex/convex-checkout-route-cutover` to make `/api/order-drafts/checkout` persist through Convex when `NEXT_PUBLIC_CONVEX_URL` and `idempotencyKey` are present.
- [x] Merged checkout route cutover PR #17 into `main` as merge commit `fa0274541a822c6b09f4c3bfd629a16f1bea3425`.
- [x] Confirmed Vercel production deployment from `main` is READY: `https://web-8dy8csodv-junyen-enterprises.vercel.app` (`dpl_C7Gbju2B9Rq1YXirHo9JM1S36NCJ`).
- [x] Re-ran post-merge route smoke tests for `https://web-8dy8csodv-junyen-enterprises.vercel.app`, `https://skydeckla.com`, and `https://www.skydeckla.com`; each 22-route matrix returned `200`.
- [x] Verified production `/api/order-drafts/checkout` still returns canonical totals and now reports `persisted: false` with `persistenceReason: "convex_unconfigured"` until Vercel receives `NEXT_PUBLIC_CONVEX_URL`.
- [x] Started branch `codex/convex-stripe-checkout-action` for the first Convex provider action.
- [x] Added `payments.createStripeCheckoutSession`, which creates Stripe Checkout Sessions from stored Convex `orderRef` records and matching draft idempotency keys instead of browser totals.
- [x] Added Stripe checkout request helpers and tests proving stored totals/line items reconcile before Stripe is called.
- [x] Added `paymentEvents.idempotencyKey` so Stripe session creation retries can be recorded without duplicate ledger rows.
- [x] Raised admin/POS dark-theme text contrast for easier reading.
- [x] Added environment, Stripe cutover, and decision docs for both human operators and future agents.
- [x] Merged Stripe Checkout action PR #19 into `main` as merge commit `edbd1d80ad43f967680b9e96c1b60c253ed04a70`.
- [x] Confirmed Vercel production deployment from `main` is READY: `https://web-5rd41qfa5-junyen-enterprises.vercel.app` (`dpl_Gue9pxpBcbd2A7z3NXip6fjsZyjJ`).
- [x] Re-ran post-merge route smoke tests for `https://web-5rd41qfa5-junyen-enterprises.vercel.app`, `https://skydeckla.com`, and `https://www.skydeckla.com`; each 22-route matrix returned `200`.
- [x] Verified production `/api/order-drafts/checkout` still ignores browser `totalCents: 1` and returns `persisted: false` with `persistenceReason: "convex_unconfigured"` until Vercel receives `NEXT_PUBLIC_CONVEX_URL`.
- [x] Started branch `codex/convex-stripe-webhook` for Stripe webhook reconciliation.
- [x] Added Convex `POST /stripe-webhook` HTTP action with raw-body Stripe signature verification.
- [x] Added internal webhook reconciliation that dedupes Stripe event IDs and marks orders paid only after stored order/payment-event amount, currency, provider, and status checks pass.
- [x] Added webhook helper tests for HMAC verification, timestamp tolerance, paid Checkout Session extraction, and ignored events.
- [x] Merged Stripe webhook reconciliation PR #22 into `main` as merge commit `0eab79bab036d1eb7cba20063e205b1d4b0eb7d6`.
- [x] Confirmed Vercel production deployment from `main` is READY: `https://web-8vpbz5v7v-junyen-enterprises.vercel.app` (`dpl_DqTuNvna51RPBqwgsZPQkaduhtth`).
- [x] Re-ran post-merge route smoke tests for `https://web-8vpbz5v7v-junyen-enterprises.vercel.app`, `https://skydeckla.com`, and `https://www.skydeckla.com`; each 22-route matrix returned `200`.
- [x] Confirmed Vercel runtime warning/error logs had no matching production entries for the checked 30-minute window.
- [x] Started branch `codex/post-webhook-readiness-hardening` for dependency/security cleanup and current-state documentation.
- [x] Pinned transitive `postcss` to `8.5.16` after `bun audit` found a moderate advisory in `postcss <8.5.10`.
- [x] Upgraded Motion to `12.42.2`.
- [x] Tried ESLint `10.6.0`; deferred because the current React lint plugin stack throws under the lint gate.
- [x] Added order-state cleanup for Stripe async payment failures so they do not remain `payment_pending`.
- [x] Added the consolidated production readiness checklist.
- [x] Merged post-webhook readiness hardening PR #23 into `main` as merge commit `28e3e6d6181cb749c9d4d1cb359622750e5c68aa`.
- [x] Confirmed Vercel production deployment from `main` is READY: `https://web-2hg4drlf9-junyen-enterprises.vercel.app` (`dpl_J2xBVUm93d9Bp92a9zxogXduFbGP`).
- [x] Re-ran post-merge route smoke tests for `https://web-2hg4drlf9-junyen-enterprises.vercel.app`, `https://skydeckla.com`, and `https://www.skydeckla.com`; each 22-route matrix returned `200`.
- [x] Started branch `codex/next-checkout-convex-cutover` from clean `main`.
- [x] Replaced the primary `/checkout` legacy rewrite with a Next.js App Router checkout page that reviews server totals first and fails closed when Convex is unconfigured.
- [x] Added `/api/payments/stripe-checkout` so the browser can request a Convex-created Stripe Checkout Session by `orderRef` and idempotency key without sending totals.
- [x] Added Convex schema/function typecheck steps to CI.
- [x] Merged Next checkout cutover PR #24 into `main` as merge commit `a9557cae76b635bb9f3221e071d785381d47ab8b`.
- [x] Confirmed Vercel production deployment from `main` is READY: `https://web-qoge89yac-junyen-enterprises.vercel.app` (`dpl_Ft1WbJraJzKNQRZKDTXnMKyhUDxo`).
- [x] Re-ran post-merge route smoke tests for `https://web-qoge89yac-junyen-enterprises.vercel.app`, `https://skydeckla.com`, and `https://www.skydeckla.com`; each 22-route matrix returned `200`.
- [x] Verified production `/api/order-drafts/checkout` still ignores browser `totalCents: 1` and returns `persisted: false` with `persistenceReason: "convex_unconfigured"` until Vercel receives `NEXT_PUBLIC_CONVEX_URL`.
- [x] Verified production `/api/payments/stripe-checkout` fails closed with `503` and `code: "convex_unconfigured"` when Convex is not configured.
- [x] Started branch `codex/pos-next-draft-spine` for a code-only POS sale draft bridge.
- [x] Added `/api/order-drafts/pos`, which accepts POS selections only, recalculates ticket/cafe/custom totals on the server, ignores browser totals, and only attempts Convex persistence when a staff bearer token and idempotency key are present.
- [x] Added native `/pos-next` App Router staff draft screen with high-contrast white text, server-total review, and locked Terminal payment.
- [x] Extended staff noindex coverage and smoke checks to `/pos-next`.
- [x] Raised legacy admin/POS dark-theme text contrast again so active staff surfaces read white-on-black while the rebuild continues.
- [x] Merged POS draft spine PR #25 into `main` as merge commit `49b6f2645df90ad76ff64e2069cb0963040f3e4d`.
- [x] Confirmed Vercel production deployment from `main` is READY: `https://web-dhnis3o2h-junyen-enterprises.vercel.app` (`dpl_31kaRK2yL5n56PgrQ7jeLXuRgY5F`).
- [x] Re-ran post-merge route smoke tests for `https://web-dhnis3o2h-junyen-enterprises.vercel.app`, `https://skydeckla.com`, and `https://www.skydeckla.com`; each 23-route matrix returned `200`.
- [x] Verified production `/api/order-drafts/pos` ignores spoofed POS totals, reader IDs, and Terminal location IDs.
- [x] Started branch `codex/terminal-sale-ref-hardening` for Stripe/card API hardening and POS Terminal sale-ref work.
- [x] Added a staff-authenticated Convex Stripe Terminal action that creates PaymentIntents from stored POS `saleRef` records and matching idempotency keys only.
- [x] Added `/api/payments/stripe-terminal`, which forwards a staff bearer token to Convex and accepts only `saleRef` plus `idempotencyKey`.
- [x] Disabled legacy browser-authoritative Stripe card checkout on `/checkout.html`; the App Router `/checkout` is now the card path.
- [x] Added fail-closed defaults to the repo copy of legacy Supabase Stripe Checkout and Terminal payment creation functions.
- [x] Merged Terminal sale-ref hardening PR #26 into `main` as merge commit `910d0fa6586f52980e95c6c5ed7ac5e9d2a69bb9`.
- [x] Confirmed Vercel production deployment from `main` is READY: `https://web-cem3bs58o-junyen-enterprises.vercel.app` (`dpl_6zSPMN5i5S4FNjUwePhN697qs76P`).
- [x] Re-ran post-merge route smoke tests for `https://web-cem3bs58o-junyen-enterprises.vercel.app`, `https://skydeckla.com`, and `https://www.skydeckla.com`; each 23-route matrix returned `200`.
- [x] Verified production `/api/order-drafts/pos` ignores spoofed POS totals, reader IDs, and Terminal location IDs; two `general` tickets returned the server catalog total of `5800` cents.
- [x] Verified production `/api/payments/stripe-checkout` and authenticated `/api/payments/stripe-terminal` probes fail closed with `503` and `code: "convex_unconfigured"` until the real Convex deployment URL is wired.
- [x] Refreshed merged-main dependency and quality gates: `bun run check`, `bun audit --audit-level=high`, `bun outdated --recursive`, and anonymous Convex function typecheck.
- [x] Started branch `codex/pos-terminal-reader-process` for server-driven Stripe Terminal reader handoff from stored POS sale refs.
- [x] Added `/api/payments/stripe-terminal/process` and `payments.processStripeTerminalPaymentIntent` so `/pos-next` can ask Stripe to process a stored PaymentIntent on the stored, allowlisted reader.
- [x] Added `SKYLA_TERMINAL_READER_REGISTRY` validation at POS draft storage, PaymentIntent creation, and reader processing time.
- [x] Merged Terminal reader handoff PR #28 into `main` as merge commit `97f42be824797f681f9a7b0e6e71b4ee4fa5302c`.
- [x] Confirmed Vercel production deployment from `main` is READY: `https://web-61n76njga-junyen-enterprises.vercel.app` (`dpl_8XKorTa795wz7RyVgvCMDN3JxANn`).
- [x] Re-ran post-merge live route checks for `https://skydeckla.com` and `https://www.skydeckla.com`; `/`, `/checkout`, `/pos-next`, `/admin`, and `/pos` returned `200`, and staff routes remained `noindex, nofollow`.
- [x] Verified live `/pos-next` in Helium: adding one General Admission reviewed to a `$29.00` server total and kept `Send to Reader` disabled until Convex/staff/reader setup exists.
- [x] Verified Vercel project `junyen-enterprises/web` still has no configured environment variables, so checkout fails closed with `convex_unconfigured`, while Terminal payment routes require staff auth before returning the same Convex gate.
- [x] Merged post-Terminal current-state docs PR #29 into `main` as merge commit `28290519ce164bfed71832f8a978acb15fa699ac`.
- [x] Confirmed Vercel production deployment from `main` is READY: `https://web-dqay6ls9s-junyen-enterprises.vercel.app` (`dpl_FqPrQ97E6sdaaZ5Tqv8gBjMU2vaD`).
- [x] Started branch `codex/payment-hosting-qa-and-contrast` for staff-page contrast, API, hosting, and dependency verification.
- [x] Re-ran live route smokes for `https://web-dqay6ls9s-junyen-enterprises.vercel.app`, `https://skydeckla.com`, and `https://www.skydeckla.com`; each 23-route matrix returned `200`.
- [x] Verified live API probes across all three production bases: spoofed checkout total returns canonical `8505` cents, spoofed POS total/reader returns canonical `5800` cents with no reader fields, and Stripe payment routes fail closed with `convex_unconfigured` when probed with required staff auth, without exposing `clientSecret`.
- [x] Raised staff-page text contrast again for legacy `/admin`, legacy `/pos`, and native `/pos-next`, and bumped legacy CSS cache versions.
- [x] Upgraded safe patch dependencies: `next` and `eslint-config-next` to `16.2.10`, and `@types/node` to `26.1.0`; left ESLint `10.6.0` deferred because the current plugin stack still needs ESLint 9.
- [x] Merged payment/hosting QA PR #30 into `main` as merge commit `a5f693ce487e0eb6fd2356a6fa21f088acc4f066`; Vercel production deployment `https://web-5k3rzg3px-junyen-enterprises.vercel.app` is READY and aliased to `skydeckla.com` and `www.skydeckla.com`.
- [x] Started branch `codex/native-admin-ops-spine` for the first native App Router admin slice.
- [x] Added native `/admin` App Router route and kept `/admin.html` as the legacy fallback.
- [x] Added `/api/admin/operations`, which requires a staff bearer token and forwards it to a staff-gated Convex query instead of reading Supabase or localStorage in the browser.
- [x] Added `admin.getOperationsSnapshot` with read-only readiness, order, POS, and payment summaries plus recent-record indexes.
- [x] Updated smoke/route tests so `/admin` is treated as a noindex App Router route while `/admin.html` remains a noindex compatibility file.
- [x] Merged native admin operations PR #31 into `main` as merge commit `b4d8ad7342ad4a993dc7178753349f9dae3e167f`.
- [x] Started branch `codex/native-admin-actions-spine` for audited booking/member status actions on the native `/admin` route.
- [x] Added staff-gated admin action routes for booking check-in/undo/cancel and member approve/waitlist/reject, each forwarding the staff bearer token to Convex.
- [x] Added Convex booking/member status mutations that validate allowed statuses, preserve payment/order data, and write audit events.
- [x] Merged native admin status actions PR #32 into `main` as merge commit `6560f5705c39daa6e832ed3e3944c2cb1d951935`.
- [x] Confirmed Vercel production deployment from `main` is READY: `https://web-1eof6htpt-junyen-enterprises.vercel.app` (`dpl_Ap7UDu3G6c5MLEitvkWfgCgrm3oD`).
- [x] Re-ran post-merge route smoke tests for `https://web-1eof6htpt-junyen-enterprises.vercel.app`, `https://skydeckla.com`, and `https://www.skydeckla.com`; each 23-route matrix returned `200`.
- [x] Verified production API probes across all three bases: spoofed checkout totals return canonical `8505` cents, spoofed POS totals/reader/location return canonical `9700` cents with no transient reader/location fields, staff routes return `401` without auth, and authenticated payment/admin routes fail closed with `convex_unconfigured` without exposing `clientSecret`.
- [x] Confirmed Vercel production logs had no error entries for the checked 30-minute window.
- [x] Started branch `codex/admin-config-spine` for the next native admin config/catalog migration slice.
- [x] Added a typed native admin config spine for announcement and hours only; pricing, menu, voucher, refund, delete, and reset workflows stay deferred until they have typed catalog/entitlement/payment reconciliation models.
- [x] Removed repo support for re-enabling legacy browser-authoritative Stripe Checkout and Terminal charge creation; retired legacy payment flags are now blocked by the tracked artifact/security guard.
- [x] Ran the dependency sweep. `bun outdated --recursive` now reports only `eslint@10.6.0`; the upgrade is intentionally held because the latest available `eslint-plugin-react@7.37.5` crashes under ESLint 10 through Next's lint config.
- [x] Tightened `/admin` and `/pos-next` text contrast so labels and secondary text render white on the black staff surfaces.
- [x] Merged native admin config PR #33 into `main` as merge commit `be24d917c418d00f81847ba33b1ea965c6dbc5a9`.
- [x] Confirmed Vercel production deployment from `main` is READY: `https://web-4jzsjm853-junyen-enterprises.vercel.app` (`dpl_5N2NVHBtKbYPEtVBRW5PXdUQuT7J`), aliased to `skydeckla.com` and `www.skydeckla.com`.
- [x] Re-ran post-merge route smoke tests for `https://web-4jzsjm853-junyen-enterprises.vercel.app`, `https://skydeckla.com`, and `https://www.skydeckla.com`; each 23-route matrix returned `200`.
- [x] Verified production API probes across all three bases: spoofed checkout totals return canonical `8505` cents, spoofed POS totals/reader/location return canonical `9700` cents with no transient reader/location fields, and authenticated payment/admin routes fail closed with `convex_unconfigured` while Convex envs are absent.
- [x] Confirmed Vercel production logs had no error entries for the checked 30-minute window.
- [x] Merged post-admin-config current-state docs PR #34 into `main` as merge commit `1af5633779f52683ac7ca04ef1171f307e62cbea`.
- [x] Confirmed Vercel production deployment from `main` is READY: `https://web-g8ev04o2t-junyen-enterprises.vercel.app` (`dpl_8kjPLDfvRvJ2PszV2rKUbet6KBD9`), aliased to `skydeckla.com` and `www.skydeckla.com`.
- [x] Verified `main` branch protection was still missing at that checkpoint;
      it remained a GitHub dashboard hardening task until the later protection
      update below.
- [x] Started branch `codex/convex-live-readiness-spine` for Convex staff bootstrap and live-readiness hardening.
- [x] Added a token-gated `staffBootstrap.upsertStaffUser` mutation so initial Convex `staffUsers` rows can be seeded through typed validation and audit events instead of manual table edits.
- [x] Extended `bun run convex:env:check` with a separate `readyForStaffBootstrap` gate for the temporary bootstrap token.
- [x] Verified local Bun canary revision `1.4.0-canary.1+eba370b69`, frozen install, full `bun run check`, Convex anonymous typecheck/codegen, `bun audit --audit-level=low`, and `bun outdated --recursive`.
- [x] Re-ran live smoke tests for `https://web-g8ev04o2t-junyen-enterprises.vercel.app`, `https://skydeckla.com`, and `https://www.skydeckla.com`; each 23-route matrix returned `200`.
- [x] Verified live payment probes across all three bases: spoofed checkout totals return canonical `8610` cents, spoofed POS totals/reader/location return canonical `4200` cents with no transient reader/location fields, Stripe Checkout/Terminal execution fails closed with `convex_unconfigured`, Terminal requires staff auth first, and no response exposes `clientSecret`.
- [x] Confirmed Vercel reports no grouped runtime errors for the project in the checked 2-hour window.
- [x] Opened readiness PR #35 and confirmed GitHub CI, CodeQL, and Vercel preview checks passed before merge.
- [x] Merged readiness PR #35 into `main` as merge commit
      `2b0b422f29f71deca52e0802f8235ba773b9c565`; Vercel production deployment
      `https://web-2vvwavkz2-junyen-enterprises.vercel.app`
      (`dpl_EnTbyZLcqo49NK6adc6Eag3Vn7k6`) is READY and the post-merge
      route/payment probes match the fail-closed state above.
- [x] Merged Terminal webhook reconciliation PR #37 into `main` as merge commit
      `18646de9a636c50fc470ffabc83f6d212884db15`; Vercel production deployment
      `https://web-51jx64rul-junyen-enterprises.vercel.app`
      (`dpl_Fz2YSWNMiagFgUXmHcrCoUpxj73B`) is READY and aliased to
      `skydeckla.com` and `www.skydeckla.com`.
- [x] Added `bun run test:payments`, a repeatable payment API smoke that checks
      spoofed checkout/POS totals are replaced, Stripe execution routes fail
      closed while Convex is unconfigured, staff auth gates Terminal routes,
      and no response exposes `clientSecret`.
- [x] Ran `bun run test:payments` against
      `https://web-51jx64rul-junyen-enterprises.vercel.app`,
      `https://skydeckla.com`, and `https://www.skydeckla.com`; each passed
      with checkout total `8505` cents and POS total `9700` cents for the
      current smoke payloads.
- [x] Retired legacy Kaskade/crypto checkout in the compatibility page and repo
      Supabase function copies after review found it could still create a
      browser-priced payment from `booking.total`.
- [x] Hardened the repo copy of the legacy Supabase Stripe webhook so bad
      signature responses no longer expose webhook-secret length/prefix details
      and old timestamps are rejected.
- [x] Extended the tracked artifact/security guard to block reintroducing
      the retired legacy Kaskade enable flag and webhook secret diagnostics.
- [x] Merged payment smoke/Kaskade retirement PR #38 into `main` as merge
      commit `79f0bad6683196222e41e09d54dd2a7909869c53`; Vercel production
      deployment `https://web-19f0ixf88-junyen-enterprises.vercel.app`
      (`dpl_5uqfp1ihft12GprzQFTddLe8chyf`) is READY and aliased to
      `skydeckla.com` and `www.skydeckla.com`.
- [x] Re-ran post-merge route and payment smokes against
      `https://web-19f0ixf88-junyen-enterprises.vercel.app`,
      `https://skydeckla.com`, and `https://www.skydeckla.com`; each passed,
      and deployed checkout assets confirmed Kaskade disabled on all three
      bases.
- [x] Merged post-payment current-state docs PR #39 into `main` as merge
      commit `a82c0b10be1fd8f291d83bed57eb4ac14300bfcc`; Vercel production
      deployment `https://web-k294uhnw0-junyen-enterprises.vercel.app`
      (`dpl_GN8Dw18L781T9wdQY25yCcNGBLg7`) is READY and aliased to
      `skydeckla.com` and `www.skydeckla.com`.
- [x] Protected GitHub `main` with strict required checks `ci-build`,
      `Analyze JavaScript and TypeScript`, and `Vercel`; force pushes, branch
      deletion, and unresolved conversations are blocked.
- [x] Hardened the remaining open GitHub CodeQL alert classes in legacy
      compatibility code: escaped checkout ticket/member admin HTML
      interpolation, removed an inline QR fallback that interpolated booking
      refs, and stopped legacy Supabase Stripe functions from echoing exception
      messages to callers.
- [x] Merged GitHub protection and legacy CodeQL hardening PR #40 into `main`
      as merge commit `e194abe670803c8484a32a48e669f61ed117f58b`; Vercel
      production deployment `https://web-rmz8b793f-junyen-enterprises.vercel.app`
      (`dpl_9ZNeHcaTqo7odZhpf4yAyGshYRQ9`) is READY and aliased to
      `skydeckla.com` and `www.skydeckla.com`.
- [x] Confirmed main CI, main CodeQL, Vercel production, and GitHub Pages
      workflows passed after PR #40.
- [x] Confirmed GitHub CodeQL has no open alerts after the PR #40 `main` scan.
- [x] Re-ran post-merge route and payment smokes against
      `https://web-rmz8b793f-junyen-enterprises.vercel.app`,
      `https://skydeckla.com`, and `https://www.skydeckla.com`; each passed
      with checkout total `8505` cents and POS total `9700` cents for the
      smoke payloads.
- [x] Confirmed Vercel grouped runtime errors found no production errors in the
      checked 30-minute window after the PR #40 smoke probes.
- [x] Visually checked live `/admin` and `/pos-next` in Helium; both staff
      surfaces remain readable with white text on black/dark panels, and
      `/pos-next` reviewed one General Admission to a server total of `$29.00`
      while keeping `Send to Reader` disabled.
- [x] Started branch `codex/native-member-application-spine` for the first
      server-durable public member application path.
- [x] Added `/api/members/applications`, which validates public applicant input,
      requires Convex before accepting, requires an idempotency key, and forwards
      only normalized fields to `memberApplications.submitApplication`.
- [x] Added Convex member application helpers and mutation code that inserts
      pending `members` rows, preserves applicant details for native admin
      review, dedupes exact retries, rejects conflicting idempotency reuse, and
      writes a compact `member.application.submit` audit event.
- [x] Expanded the native admin member projection so new Convex member
      applications can show applicant name, email, phone, source, bio, tier,
      status, and timestamps instead of only a thin email/tier summary.
- [x] Merged native member application PR #42 into `main` as merge commit
      `0219a838e879c7f611c35d5c19dba06476de7ce7`; Vercel production deployment
      `https://web-b474ddr4i-junyen-enterprises.vercel.app`
      (`dpl_6ENBkgnH2iUZXmkGFgki68ueatq7`) is READY and aliased to
      `skydeckla.com` and `www.skydeckla.com`.
- [x] Confirmed main CI, main CodeQL, Vercel production, and GitHub Pages
      workflows passed after PR #42.
- [x] Re-ran post-merge route smokes against
      `https://web-b474ddr4i-junyen-enterprises.vercel.app`,
      `https://skydeckla.com`, and `https://www.skydeckla.com`; each passed
      the 23-route matrix.
- [x] Re-ran post-merge payment smokes against the same three bases; each passed
      with checkout total `8505` cents, POS total `9700` cents, and Stripe
      execution routes failing closed instead of exposing payment secrets.
- [x] Probed `/api/members/applications` with an empty no-write payload on the
      latest Vercel deployment, apex domain, and `www`; each returned `503` with
      `code: "convex_unconfigured"`, so the public member path is safely blocked
      until the real Convex deployment URL is set.
- [x] Confirmed Vercel grouped runtime errors found no production errors in the
      checked 2-hour window after the PR #42 deployment and smoke probes.
- [x] Visually checked local `/admin`, `/pos-next`, `/pos`, and `/admin.html` in
      Helium; staff/admin surfaces remain readable with white text on
      black/dark panels.
- [x] Merged staff stylesheet cache-bust PR #44 into `main` as merge commit
      `aa1b7d6fdd9d613605d57429a1554982d0587eae`; Vercel production deployment
      `https://web-4dgb61b60-junyen-enterprises.vercel.app`
      (`dpl_Fk9fhLYJ67PuuWn3Z7jJBz3UPCTm`) is READY and aliased to
      `skydeckla.com` and `www.skydeckla.com`.
- [x] Confirmed PR #44 main CI, main CodeQL, Vercel production, GitHub Pages,
      route smokes, payment smokes, no-write member API probes, Vercel runtime
      errors, and Helium staff contrast checks after deployment.
- [x] Merged production-readiness smoke PR #45 into `main` as merge commit
      `59b62f56e8018e38f57f28f19a30e599abdd0e8d`; Vercel production deployment
      `https://web-k2mvfzmip-junyen-enterprises.vercel.app`
      (`dpl_24ZzQNr3tuWGb51n5wZy8qjZdHMm`) is READY and aliased to
      `skydeckla.com` and `www.skydeckla.com`.
- [x] Confirmed Vercel reports no grouped production runtime errors in the
      checked 24-hour window after PR #45, and no production error/fatal logs
      in the checked 2-hour window.
- [x] Merged payment/hosting/readability PR #46 into `main` as merge commit
      `6496f8d97d7f82f1b6a34c055edeee4cc5930d8b`; Vercel production deployment
      `https://web-5h8rxbvkt-junyen-enterprises.vercel.app`
      (`dpl_H1kj5ydUA9KTxnUpXKY5t1S2nLZo`) is READY and aliased to
      `skydeckla.com` and `www.skydeckla.com`.
- [x] Confirmed PR #46 CI, CodeQL, Vercel preview, preview smokes, production
      route/payment/production-readiness smokes across the Vercel URL plus both
      custom domains, Vercel runtime errors/logs, and Helium visual QA for
      `/admin.html`, `/pos.html`, `/admin`, and `/pos-next`.

## In Progress

- [x] Re-run custom-domain smoke tests without DNS overrides after local OS/browser DNS caches stop returning stale GitHub Pages answers.
- [x] Review subagent audits for Convex/functionality, repo/assets cleanup, and QA/security.
- [x] Land the Phase 2 roadmap and Bun/Vercel runbook.
- [x] Land the QA/security baseline PR and confirm GitHub CI, CodeQL, and Vercel preview/production are green.
- [x] Create the Bun migration PR only after local canary install/checks are reproducible.
- [x] Open the Bun/root-cleanup PR and verify GitHub CI plus Vercel preview.
- [x] Smoke-test the Vercel preview with `SMOKE_BASE_URL=<preview-url> bun run test:smoke`.
- [x] Verify, review, and ship `codex/convex-order-spine`.
- [x] Verify, review, and ship `codex/convex-persist-order-drafts`.
- [x] Verify, review, and ship `codex/convex-checkout-route-cutover`.
- [x] Verify, review, and ship `codex/convex-stripe-checkout-action`.
- [x] Verify, review, and ship `codex/convex-stripe-webhook`.
- [x] Verify, review, and ship `codex/post-webhook-readiness-hardening`.
- [x] Verify, review, and ship `codex/next-checkout-convex-cutover`.
- [x] Verify, review, and ship `codex/pos-next-draft-spine`.
- [x] Verify, review, and ship `codex/terminal-sale-ref-hardening`.
- [x] Verify, review, and ship `codex/pos-terminal-reader-process`.
- [x] Verify, review, and ship `codex/payment-hosting-qa-and-contrast`.
- [x] Verify, review, and ship `codex/native-admin-ops-spine`.
- [x] Verify, review, and ship `codex/native-admin-actions-spine`.
- [x] Verify, review, and ship `codex/admin-config-spine`.
- [x] Verify, review, and ship `codex/convex-live-readiness-spine`.
- [x] Verify, review, and ship `codex/terminal-webhook-reconciliation`.
- [x] Verify, review, and ship `codex/payment-api-smoke-current-state`.
- [x] Verify, review, and ship `codex/post-payment-smoke-production-state`.
- [x] Verify, review, and ship `codex/github-main-protection-state`.
- [x] Verify, review, and ship `codex/post-github-hardening-production-state`.
- [x] Verify, review, and ship `codex/native-member-application-spine`.
- [x] Verify, review, and ship `codex/post-member-application-production-state`.
- [x] Verify, review, and ship `codex/staff-contrast-cache-bust`.
- [x] Verify, review, and ship `codex/production-readiness-smoke`.
- [x] Verify, review, and ship `codex/payment-hosting-readability-check`.
- [x] Verify, review, and ship `codex/post-payment-hosting-state`.
- [x] Verify, review, and ship `codex/root-legacy-regression-guard`.
- [x] Verify, review, and ship `codex/legal-pages-app-router`.
- [x] Verify, review, and ship `codex/legal-compat-copy`.
- [x] Verify, review, and ship `codex/public-content-app-router`.
- [x] Rechecked payment/API, dependency, GitHub, and Vercel production state
      before shipping `codex/public-content-app-router`: `bun run check`,
      `bun run security:audit`, `bun audit --audit-level=low`,
      `bun outdated --recursive`, custom-domain route smokes,
      custom-domain payment smokes, and `bun run test:production-readiness`
      passed. `bun run convex:env:check` still fails as expected because
      Vercel has no project env vars and Convex is not linked.
- [x] Merged public content App Router PR #51 into `main` as
      `37df37c9c20194fa67e93847b5b9cbb8a76092d1`; Vercel production
      deployment `https://web-gg92osnfi-junyen-enterprises.vercel.app`
      (`dpl_6PW4HQNh9LF2XKqt92Tx1ENDZxDt`) is READY and aliased to
      `skydeckla.com` and `www.skydeckla.com`.
- [x] Re-ran post-merge route smokes, payment smokes, and production-readiness
      smoke against the Vercel deployment plus both custom domains. About/cafe
      are native App Router pages, their `.html` compatibility URLs still
      return `200`, and neither path loads `shared-data.js`.
- [x] Started branch `codex/native-members-cutover` from clean `origin/main`
      to move the visible `/members` page into App Router while keeping
      `/members.html` as compatibility fallback.
- [x] Added native `/members` page and client form that post to
      `/api/members/applications` with an idempotency key and only show success
      after the server accepts the application.
- [x] Preserved membership lead tracking hooks after accepted submissions, but
      removed the active `/members` route from the legacy
      `SkylaData.addMember` localStorage/Supabase write path.
- [x] Merged native members cutover PR #54 into `main` as merge commit
      `2d8b1a78fc7f0df3cd01218ec05a7579ebc5abf2`; Vercel production
      deployment `https://web-ec9pf9hly-junyen-enterprises.vercel.app`
      (`dpl_EEP2DithtH52i8ixpsCtLQ5Bo9JM`) is READY and aliased to
      `skydeckla.com` and `www.skydeckla.com`.
- [x] Re-ran post-merge route, payment, and production-readiness smokes against
      the Vercel deployment plus both custom domains. `/members` is native,
      `/members.html` is a compatibility handoff, and neither path exposes
      `shared-data.js` or `SkylaData.addMember`.
- [x] Checked Vercel logs for the PR #54 deployment after smoke probes; no
      error/fatal logs appeared in the checked 1-hour window, and the visible
      503/401 entries were expected no-write gates.
- [x] Started branch `codex/native-experiences-cutover` from clean
      `origin/main` to move the visible `/experiences` page into App Router
      while keeping `/experiences.html` as a compatibility handoff.
- [x] Added native `/experiences` page and client form that post to
      `/api/experiences/inquiries` with an idempotency key and only fire lead
      tracking after the server accepts the inquiry.
- [x] Preserved event inquiry content and tracking hooks, but removed the
      active `/experiences` route from the legacy `SkylaData.addInquiry`
      localStorage/Supabase write path.
- [x] Merged native experiences cutover PR #56 into `main` as merge commit
      `65d2764d2981c77cb33473d17cf24d480675f2bc`; Vercel production
      deployment `https://web-lbez0fbvp-junyen-enterprises.vercel.app`
      (`dpl_FCx8Urf1iuvG8j357tBP6eKKoFYT`) is READY and aliased to
      `skydeckla.com` and `www.skydeckla.com`.
- [x] Re-ran post-merge route, payment, and production-readiness smokes against
      the Vercel deployment plus both custom domains. `/experiences` is native,
      `/experiences.html` is a compatibility handoff, and neither path exposes
      `shared-data.js` or `SkylaData.addInquiry`.
- [x] Rechecked dependencies, CodeQL, payment/API probes, and production logs
      after PR #56. `bun audit --audit-level=low`, `bun run security:audit`,
      and GitHub CodeQL passed with no open code-scanning alerts. The only
      `bun outdated --recursive` item is deferred `eslint@10.6.0`.
- [x] Checked Vercel logs for the PR #56 deployment after smoke probes; no
      error/fatal logs appeared in the fetched window, and the visible
      503/401 entries were expected Convex/staff-auth no-write gates.
- [x] Started branch `codex/checkout-compat-handoff` from clean `origin/main`
      to remove the remaining public legacy checkout implementation.
- [x] Replaced `apps/web/public/checkout.html` with a compatibility handoff to
      native `/checkout` and removed the unused public `checkout.js` and
      `checkout.css` files so the old browser-authoritative booking/payment
      script is no longer shipped.
- [x] Updated smoke tests, route tests, runbooks, and Google Ads launch
      materials to assert and use the native `/checkout` path.
- [x] Started branch `codex/admin-pos-readability-audit` from clean
      `origin/main` after PR #58 to recheck admin/POS readability, Stripe/API
      safety, dependencies, and hosting state.
- [x] Confirmed Vercel project `junyen-enterprises/web` is still on Node
      `24.x`, the PR #62 production deployment
      `https://web-g6cp2p7an-junyen-enterprises.vercel.app`
      (`dpl_J73keiyGYXdQTtv1NKX3uhW6vDPB`) is READY from merge commit
      `071ed79d9dd8c89c1ffca8eb849b7ec742090565`, and aliases include
      `skydeckla.com` and `www.skydeckla.com`.
- [x] Confirmed Vercel env vars are still absent, so payment/member/experience
      server writes remain safely blocked with `convex_unconfigured` until the
      real Convex and Stripe dashboard setup is done.
- [x] Updated GitHub repo metadata to point the homepage at
      `https://skydeckla.com`, enabled Dependabot vulnerability alerts, enabled
      automated security fixes, and disabled the old GitHub Pages deployment
      surface now that Vercel custom domains are verified.
- [x] Re-ran Bun canary dependency checks. `bun install --canary` made no
      changes, `bun audit --audit-level=low` found no vulnerabilities, and
      `bun outdated --recursive` only reports deferred `eslint@10.6.0`.
- [x] Re-tested `eslint@10.6.0`; lint still fails through
      `eslint-plugin-react@7.37.5`, so ESLint remains pinned to `9.39.4`.
- [x] Bumped legacy staff CSS cache keys to `admin.css?v=8` and `pos.css?v=10`,
      raised disabled/used state opacity on dark staff surfaces, and added a
      regression test that keeps native/legacy admin and POS text high-contrast
      while legacy POS charging stays disabled.
- [x] Escaped legacy POS catalog, cart, and receipt render paths so custom
      staff-entered item names cannot inject markup while `/pos` remains a
      compatibility surface.
- [x] Started branch `codex/native-admin-checkin` from clean `origin/main`
      after PR #60 for the next staff workflow migration slice.
- [x] Added a native front-desk booking lookup path:
      `/api/admin/bookings/lookup` requires a staff bearer token, fails closed
      when Convex is unconfigured, forwards only bounded lookup parameters to
      Convex, and supports exact booking-reference lookup plus bounded email
      lookup.
- [x] Added `admin.lookupBookingForCheckIn` so native `/admin` can find
      bookings through staff-gated Convex indexes and use the existing audited
      booking status mutation for check-in/undo actions.
- [x] Added a native `/admin` Booking Lookup panel for QR/barcode/manual
      booking-reference entry while leaving vouchers, refunds, destructive
      actions, pricing/menu/catalog edits, reader setup, and live POS charging
      out of scope.
- [x] Local rendered `/admin` checks confirmed the Booking Lookup panel appears
      and the native route does not expose `SkylaData` or `shared-data.js`.
      Helium/Computer Use visual capture still returns `cgWindowNotFound` or a
      wallpaper-only screenshot on this Mac, so the slice relies on rendered
      HTML/CSS assertions and smoke tests until browser capture is restored.
- [x] Started branch `codex/legacy-staff-fallback-lockdown` from clean
      `origin/main` after PR #64 to reduce the remaining staff/Supabase fallback
      surface without dashboard secrets.
- [x] Reviewed subagent audits for legacy admin writes, POS reader setup, Stripe
      Terminal action latches, and Supabase function retirement guards.
- [x] Locked legacy `/admin.html` writes behind
      `LEGACY_ADMIN_MUTATIONS_ENABLED = false`, made old editor sections
      read-only, and added route/security/smoke guards for the lock.
- [x] Retired legacy `/pos.html` reader setup in repo code and made the
      Supabase `stripe-terminal` copy return `410` for `setup-reader` as well as
      old charge/reader bridge actions.
- [x] Added `SKYLA_POS_TERMINAL_ACCEPTANCE` checking directly inside Convex
      `payments.processStripeTerminalPaymentIntent`.
- [x] Re-ran dependency checks on 2026-07-05. `bun audit --audit-level=low`
      reports no vulnerabilities, `bun outdated --recursive` only reports
      deferred `eslint@10.6.0`, and a direct ESLint 10 trial still fails through
      `eslint-plugin-react@7.37.5`, so ESLint remains pinned to `9.39.4`.
- [x] Merged legacy staff fallback lockdown PR #65 into `main` as merge commit
      `33ba3854b686cb46ceef62e58806eb3ffff13ccf`.
- [x] Confirmed Vercel production deployment from `main` is READY:
      `https://web-decldr0pu-junyen-enterprises.vercel.app`
      (`dpl_62iVfWRBejYwK6nRvrBgXfzbkoQP`), aliased to `skydeckla.com` and
      `www.skydeckla.com`.
- [x] Re-ran post-merge route, payment, and production-readiness smokes for the
      production deployment URL, apex domain, and `www`; all passed.
- [x] Started branch `codex/native-admin-voucher-redemption` from clean
      `origin/main` after docs PR #66.
- [x] Added shared voucher entitlement helpers in `@skyla/payments` so package
      inclusions and purchased add-on vouchers are calculated from typed data
      instead of browser constants.
- [x] Added Convex `voucherRedemptionEvents` plus native admin voucher lookup
      state and `admin.updateBookingVoucherRedemption`; redeem/undo requires
      admin or POS staff, blocks cancelled bookings, requires linked native
      orders to be `paid`, and records audit events.
- [x] Added `/api/admin/bookings/vouchers` and native `/admin` lookup-card
      controls for voucher redeem/undo with high-contrast white staff text.
- [x] Added voucher tests for shared payment helpers, Convex helper math, admin
      audit metadata, and the Next admin route contract.
- [x] Merged native admin voucher redemption PR #67 into `main` as merge commit
      `1a4b52a0993ba8c69ad20456716246dc3d24370b`.
- [x] Confirmed Vercel production deployment from `main` is READY:
      `https://web-7s20mwxo9-junyen-enterprises.vercel.app`
      (`dpl_AVbzMd2HR6bKp8JLDWcaM2BvSBjk`), aliased to `skydeckla.com` and
      `www.skydeckla.com`.
- [x] Re-ran post-merge route, payment, and production-readiness smokes for the
      production deployment URL, apex domain, and `www`; all passed.
- [x] Confirmed Vercel reported no grouped runtime errors and no error/fatal
      logs for deployment `dpl_AVbzMd2HR6bKp8JLDWcaM2BvSBjk` in the checked
      one-hour window.
- [x] Merged staff compatibility app retirement PR #69 into `main` as merge
      commit `43628ae31de2d3f0f49a46ba0b6abb266b9991df`.
- [x] Confirmed Vercel production deployment from `main` is READY:
      `https://web-3qvcb9sh3-junyen-enterprises.vercel.app`
      (`dpl_2zLDfubZkh35R5qdRbeqafr98JKz`), aliased to `skydeckla.com` and
      `www.skydeckla.com`.
- [x] Re-ran post-merge route, payment, and production-readiness smokes for the
      production deployment URL, apex domain, and `www`; all passed.
- [x] Confirmed `/admin.html` and `/pos.html` return `200` while retired staff
      assets `admin.js`, `pos.js`, `shared-data.js`, `admin.css`, and `pos.css`
      return `404` on the deployment URL, apex domain, and `www`.
- [x] Confirmed Vercel reported no grouped runtime errors and no error/fatal
      logs for deployment `dpl_2zLDfubZkh35R5qdRbeqafr98JKz` in the checked
      one-hour window.
- [x] Started branch `codex/pos-reader-registry-selector` from clean
      `origin/main` after PR #70 to remove free-text Terminal reader/location
      entry from the native POS flow.
- [x] Added staff-gated `/api/pos/readers` backed by Convex
      `admin.listTerminalReaders`, with empty and duplicate
      `SKYLA_TERMINAL_READER_REGISTRY` entries failing closed.
- [x] Replaced native `/pos` reader and location text boxes with an authorized
      reader selector loaded from Convex after staff auth.
- [x] Tightened `/api/order-drafts/pos` so browser-sent
      `terminalLocationId` is no longer forwarded; Convex derives stored
      Terminal location from the trusted reader registry.
- [x] Merged POS reader registry selector PR #71 into `main` as merge commit
      `64864f9366fbdc03a38eb1da2f1d307e3ff1b747`.
- [x] Confirmed Vercel production deployment from `main` is READY:
      `https://web-3x58j0erd-junyen-enterprises.vercel.app`
      (`dpl_4sAftkmpovb9AqPrst3kv8hXKBe3`), aliased to `skydeckla.com` and
      `www.skydeckla.com`.
- [x] Re-ran post-merge route, payment, and production-readiness smokes for the
      production deployment URL, apex domain, and `www`; all passed, including
      the new `/api/pos/readers` staff-auth gate.
- [x] Confirmed Vercel returned no production error/fatal logs for deployment
      `dpl_4sAftkmpovb9AqPrst3kv8hXKBe3` in the fetched one-hour window after
      smoke probes.
- [x] Started branch `codex/supabase-checkout-retirement` from clean
      `origin/main` after PR #72 to remove the final legacy Supabase Stripe
      Checkout read path.
- [x] Replaced the repo copy of `supabase/functions/stripe-checkout` with an
      unconditional `410` stub for every non-OPTIONS request, including old
      Checkout session verification.
- [x] Added artifact and route-test guards so the retired legacy verification
      branch and direct Stripe Checkout session lookups cannot return unnoticed.
- [x] Merged Supabase checkout retirement PR #73 into `main` as merge commit
      `ad51579cd77f03e1f6c4542c10b392c234a1321c`.
- [x] Confirmed Vercel production deployment from `main` is READY:
      `https://web-7cpgrzyo6-junyen-enterprises.vercel.app`
      (`dpl_L1sNjzQFh6TzLANFs6QzdZuJrC8J`), aliased to `skydeckla.com` and
      `www.skydeckla.com`.
- [x] Re-ran post-merge route, payment, and production-readiness smokes for the
      production deployment URL, apex domain, and `www`; all passed.
- [x] Checked Vercel logs for deployment
      `dpl_L1sNjzQFh6TzLANFs6QzdZuJrC8J` after smoke probes; no error/fatal
      logs appeared in the fetched one-hour window, and the visible entries were
      expected info-level route checks plus intentional `401` and
      `503 convex_unconfigured` probes.
- [x] Started branch `codex/acceptance-readiness-harness` from clean
      `origin/main` after PR #74 to make dashboard-linked Convex/Stripe Preview
      acceptance repeatable.
- [x] Added staff-gated `/api/admin/acceptance-readiness` and
      `bun run test:acceptance:linked`, an opt-in linked Preview harness that
      verifies remote test-mode readiness before writes, Convex persistence,
      public intake APIs, staff-gated POS reader listing, POS draft persistence,
      no `clientSecret` leaks, and optional Stripe Checkout/test-reader
      acceptance without using real cards.
- [x] Merged linked acceptance readiness PR #75 into `main` as merge commit
      `a644ad1483f7b03b3fd54481d7d07441265e5d31`.
- [x] Confirmed Vercel production deployment from `main` is READY:
      `https://web-l6id8jdjf-junyen-enterprises.vercel.app`
      (`dpl_FAgDgqK2exPEecMvcPdcR2PnoWaT`), aliased to `skydeckla.com` and
      `www.skydeckla.com`.
- [x] Re-ran post-merge route, payment, and production-readiness smokes for the
      production deployment URL, apex domain, and `www`; all passed, including
      the staff-gated `/api/admin/acceptance-readiness` probe.
- [x] Confirmed the linked acceptance harness refuses `skydeckla.com` without
      `SKYLA_ALLOW_PRODUCTION_ACCEPTANCE=1` after PR #75.
- [x] Checked Vercel logs for deployment
      `dpl_FAgDgqK2exPEecMvcPdcR2PnoWaT` after smoke probes; no error/fatal logs
      appeared in the fetched one-hour window, and the visible entries were
      expected info-level route checks plus intentional staff-gated `401` and
      `503 convex_unconfigured` probes.
- [x] Merged acceptance harness docs-state PR #76 into `main` as merge commit
      `5a7e46a3e5dc28b72ff2681b896084ba91e045ec`.
- [x] Confirmed docs-state Vercel production deployment evidence from `main`
      was READY:
      `https://web-1n1r4myow-junyen-enterprises.vercel.app`
      (`dpl_Eb9L2qE3GQC4UK5qtHDxBV77zEvL`), aliased to `skydeckla.com` and
      `www.skydeckla.com`.
- [x] Re-ran post-merge route, payment, and production-readiness smokes for the
      docs-state production deployment URL, apex domain, and `www`; all passed.
- [x] Rechecked live `/admin` and `/pos-next` in Helium on 2026-07-05; both
      staff surfaces rendered readable white text on black backgrounds.
- [x] Checked Vercel error/fatal runtime logs for deployment
      `dpl_Eb9L2qE3GQC4UK5qtHDxBV77zEvL`; no logs matched that severity in the
      one-hour window after smoke probes.
- [x] Started branch `codex/admin-csv-exports` from clean `origin/main` after
      PR #78 to add native admin export support without touching the older dirty
      local checkout.
- [x] Added admin-only `/api/admin/export` plus Convex
      `admin.getAdminExportRows` for bookings, members, inquiries, orders, POS
      sales, and payment events. The CSV route uses explicit columns,
      formula-safe cell escaping, no-store responses, and masked
      Stripe/Terminal operational identifiers.
- [x] Merged admin CSV exports PR #79 into `main` as merge commit
      `7ae39fb6fc529b257ac640d0af7051cafc7835dd`; GitHub `ci-build`,
      CodeQL, Vercel preview, and Vercel preview comments checks all passed.
- [x] Confirmed Vercel production deployment from `main` is READY:
      `https://web-mdyodg473-junyen-enterprises.vercel.app`
      (`dpl_Cz1PXEHLPNNUwUTpK8KK4iznqNQR`), aliased to `skydeckla.com` and
      `www.skydeckla.com`.
- [x] Re-ran post-merge route, payment, and production-readiness smokes for
      the production deployment URL, apex domain, and `www`; all passed.
- [x] Verified `/api/admin/export?kind=bookings` on the production deployment
      URL, apex domain, and `www` returns `401 staff_auth_required` without
      staff auth and `503 convex_unconfigured` with a fake staff token while
      Convex envs are absent. Both paths returned `Cache-Control: no-store` and
      `Vary: Authorization`.
- [x] Checked production `/admin` and `/pos` screenshots after PR #79 with
      local headless Chrome because Helium was running but exposed zero
      accessibility windows in this run. Both staff surfaces rendered readable
      white text on black backgrounds without obvious overlap.
- [x] Confirmed Vercel reported no grouped runtime errors and no error/fatal
      logs for deployment `dpl_Cz1PXEHLPNNUwUTpK8KK4iznqNQR` in the checked
      one-hour window after smoke probes.
- [x] Started branch `codex/current-state-qa-checklist` to refresh production
      QA evidence, dependency state, catalog parity, and simple handoff docs
      after the admin CSV export production deployment.
- [x] Verified Vercel production deployment `dpl_HsyodqFxmmAyuRAKJoQ3szcmos79`
      is ready for commit `a322ea0363d28683b6515bcb5261241b8c5535a3`, with
      `skydeckla.com` and `www.skydeckla.com` attached.
- [x] Re-ran route, payment, and production-readiness smokes against the
      deployment URL, apex domain, and `www` domain. Payment probes still use
      server-owned totals and fail closed before real Stripe execution while
      Convex is unconfigured.
- [x] Re-ran Bun canary dependency checks on `1.4.0-canary.1+d37f52067`.
      `bun install --canary --frozen-lockfile` made no repo changes,
      `bun audit --audit-level=low` found no vulnerabilities, and
      `bun outdated --recursive` still reports only the intentionally deferred
      ESLint 10 major.
- [x] Re-ran the dependency sweep on 2026-07-06 in branch
      `codex/convex-catalog-versioning`: upgraded `vitest` from `4.1.9` to
      `4.1.10`, confirmed `bun install --canary --frozen-lockfile` passes, and
      re-tested ESLint `10.6.0`. ESLint 10 still fails through
      `eslint-plugin-react@7.37.5`, so web lint remains pinned to
      `eslint@9.39.4`.
- [x] Added a follow-up staff API cache hardening slice after production probes
      showed default cache headers on the new admin catalog route. Shared staff
      JSON responses now set `Cache-Control: no-store` and
      `Vary: Authorization`, with regression coverage.
- [x] Merged Convex catalog versioning PR #83 into `main` as merge commit
      `2c0a5990629245e64a147118120c9846994470e4`. GitHub CI, CodeQL, and
      Vercel checks passed.
- [x] Merged staff API cache header PR #84 into `main` as merge commit
      `c52239079288e45e7fb5c8758a312753bdb420d4`. Production deployment
      `dpl_4MFjVoPD8ewFLtC9DRHSTawMpoZF` reached `READY`, aliases attached, and
      route, payment, and production-readiness smokes passed on the deployment
      URL, `skydeckla.com`, and `www.skydeckla.com`.
- [x] Verified PR #84 production header probes: `/api/admin/catalog` and
      `/api/pos/readers` return `Cache-Control: no-store` and
      `Vary: Authorization` for staff-gated and fail-closed responses. Vercel
      runtime checks showed no grouped runtime errors and no error/fatal logs.
- [x] Added `@skyla/payments` catalog list/provenance helpers and routed public
      ticket display, checkout, cafe, admin, and POS option lists through those
      helpers so displayed prices stay aligned with payment-authoritative price
      data.
- [x] Added a plain-English current-state handoff at
      `docs/current-state-simple.md` with architecture, dashboard checklist,
      latest evidence, and next code work.
- [x] Merged current-state QA PR #81 into `main` as merge commit
      `7d93c3600d23f5df2ca449d2ef441066c735fab4`; GitHub/Vercel checks passed.
- [x] Confirmed Vercel production deployment from `main` is READY:
      `https://web-2e5u36ye7-junyen-enterprises.vercel.app`
      (`dpl_4PTqPnqrwyJjm8hFX3T1FZN2UfQn`), aliased to `skydeckla.com` and
      `www.skydeckla.com`.
- [x] Re-ran post-merge route, payment, and production-readiness smokes for
      the deployment URL, apex domain, and `www`; all passed. Payment probes
      returned checkout total `8505` cents and POS total `9700` cents, and
      Stripe execution routes stayed fail-closed before real Convex/Stripe
      dashboard wiring.
- [x] Verified `/api/admin/export?kind=bookings` on the post-PR-81 production
      deployment, apex domain, and `www` returns `401` without staff auth and
      `503 convex_unconfigured` with a fake staff token. Responses stayed
      `Cache-Control: no-store` and `Vary: Authorization`.
- [x] Checked production `/admin` and `/pos` in Helium after PR #81. Both staff
      surfaces rendered readable white text on black backgrounds; `/pos` hands
      off to the native `/pos-next` shell during rollout.
- [x] Confirmed Vercel runtime logs for deployment
      `dpl_4PTqPnqrwyJjm8hFX3T1FZN2UfQn` showed expected public `200`,
      staff-gated `401`, and Convex-unconfigured `503` smoke probes with no
      error/fatal rows in the fetched one-hour window.
- [x] Started branch `codex/convex-catalog-versioning` for the next
      no-dashboard Convex catalog governance slice.
- [x] Added Convex catalog versioning tables, immutable product snapshots,
      code-owned catalog seeding, audited version activation/rollback, and a
      staff-gated `/api/admin/catalog` bridge.
- [x] Kept checkout/POS runtime pricing on `@skyla/payments`; admin price edits
      remain deferred until linked Convex acceptance proves the seeded catalog
      path.
- [x] Verified focused catalog gates locally:
      `bunx vitest run convex/catalogVersioning.test.ts
      apps/web/admin-catalog-route.test.ts`, `bun run convex:test:unit`,
      `bun run convex:schema:typecheck`, `bun run convex:functions:typecheck`,
      web typecheck, and anonymous
      `CONVEX_AGENT_MODE=anonymous bunx convex dev --once --typecheck enable`.
- [x] Started branch `codex/acceptance-dry-run-harness` after PR #85 to add a
      no-write linked acceptance preflight before the dashboard-linked write
      harness creates test records.
- [x] Added `SKYLA_ACCEPTANCE_PREFLIGHT=1` / `bun run
      test:acceptance:preflight`, required-gate support for
      `bun run convex:env:check`, and stricter Terminal readiness that requires
      signed Stripe webhook readiness before reader processing is considered
      ready.
- [x] Verified the preflight with a local stub server: authenticated readiness
      and POS reader probes passed, and the harness made zero write requests.
- [x] Started branch `codex/acceptance-harness-tests` after PR #86 to add
      durable script-level tests for the no-write preflight and required
      Convex env gates.
- [x] Merged acceptance harness tests PR #87 into `main` as merge commit
      `c6f9301f48d7a9a25700381b9931846c5b9d22f8`; GitHub CI, CodeQL, and
      Vercel preview checks passed.
- [x] Confirmed Vercel production deployment from PR #87 is READY:
      `https://web-ll86xe2or-junyen-enterprises.vercel.app`
      (`dpl_HPqZptoZ36XiU6vTBL6XHAGgdnMv`), with `skydeckla.com` and
      `www.skydeckla.com` attached to the project.
- [x] Re-ran post-PR-87 route and payment smokes on `https://skydeckla.com`.
      Both passed; payment execution still fails closed without Convex/Stripe
      dashboard wiring and no real Stripe charge was attempted.
- [x] Checked Vercel runtime evidence after PR #87: no grouped runtime errors
      in the selected 30-minute window and no error/fatal logs for deployment
      `dpl_HPqZptoZ36XiU6vTBL6XHAGgdnMv`.
- [x] Started branch `codex/post-pr87-readiness-refresh` to refresh stale
      readiness docs, keep staff UI text white-on-dark, and harden public
      Stripe response allowlists against accidental `clientSecret` leakage.
- [x] Merged post-PR87 readiness refresh PR #88 into `main` as merge commit
      `fe58c15d613db72218d8067d62eb894373468c25`; GitHub CI, CodeQL, Vercel,
      and Vercel Preview Comments checks passed.
- [x] Confirmed Vercel production deployment from PR #88 is READY:
      `https://web-7w0hqfpoq-junyen-enterprises.vercel.app`
      (`dpl_Bn8CdKbpvmDpaXhuMNYPxTpTjH5Y`), with `skydeckla.com` and
      `www.skydeckla.com` attached to the project.
- [x] Re-ran post-PR88 route, payment, and production-readiness smokes on
      `https://skydeckla.com`; the production-readiness smoke also checked
      `https://www.skydeckla.com`. All passed, with payment execution still
      fail-closed before Convex/Stripe dashboard wiring and no real Stripe
      charge attempted.
- [x] Checked Vercel runtime evidence after PR #88: no grouped runtime errors
      in the selected 30-minute window and no error/fatal logs for deployment
      `dpl_Bn8CdKbpvmDpaXhuMNYPxTpTjH5Y`.
- [x] Started branch `codex/post-pr88-production-evidence` to record PR #88
      production evidence without changing app behavior.
- [x] Started branch `codex/legacy-supabase-retirement-guard` to keep the
      transition Supabase payment/webhook stubs fail-closed in repo code while
      dashboard decommissioning remains a separate external step.
- [x] Removed the Supabase server helper wrapper from the retired legacy
      Stripe Terminal function so it returns the retired response before any
      Supabase helper can initialize.
- [x] Added `bun run security:supabase-retired` plus script tests. The guard
      checks all five legacy Supabase Stripe/Kaskade payment and webhook
      function stubs for HTTP-410 retired behavior and blocks Supabase helper,
      Stripe API, or Kaskade API calls from returning.
- [x] Merged Supabase retirement guard PR #90 into `main` as merge commit
      `f4ea5dd4cd6143a355324959d8e07f5418c21ae0`; GitHub CI, CodeQL, Vercel,
      and Vercel Preview Comments checks passed.
- [x] Confirmed Vercel production deployment from PR #90 is READY:
      `https://web-dpvhq5x3y-junyen-enterprises.vercel.app`
      (`dpl_7wm65ZC3MmUxaCExYdQJ2AHc5wnj`).
- [x] Re-ran post-PR90 route, payment, and production-readiness smokes on
      `https://skydeckla.com`; the production-readiness smoke also checked
      `https://www.skydeckla.com`. All passed, with Stripe execution still
      fail-closed before Convex/Stripe dashboard wiring and no real Stripe
      charge attempted.
- [x] Checked Vercel runtime evidence after PR #90: no grouped runtime errors
      in the selected 30-minute window and no error/fatal logs for deployment
      `dpl_7wm65ZC3MmUxaCExYdQJ2AHc5wnj`.
- [x] Started branch `codex/post-pr90-production-evidence` to record PR #90
      production evidence without changing app behavior.
- [x] Started branch `codex/live-supabase-retirement-smoke` to make the
      remaining Supabase dashboard decommissioning step externally verifiable.
- [x] Made the repo copy of legacy Supabase `stripe-terminal` return `410` for
      every non-OPTIONS request, including harmless unknown probe actions.
- [x] Added `bun run test:supabase-retired:live`, a no-card live smoke that
      checks `stripe-checkout`, `stripe-terminal`, `stripe-webhook`,
      `kaskade-payment`, and `kaskade-webhook` against a supplied Supabase
      functions base URL and accepts only disabled `404` or retired `410`.
- [ ] Link the real Convex deployment and replace anonymous local Convex validation with project-linked codegen in a follow-up PR.

## Deferred Until Foundation Is Stable

- [x] Convex generated types and persisted draft mutations.
- [ ] Real Convex cloud deployment link and Vercel env wiring.
- [x] Convex Stripe HTTP webhook action.
- [x] Legacy Kaskade browser-authoritative checkout and webhook are retired in
      repo code.
- [ ] Future Kaskade webhook/action handling may return only after it is
      rebuilt as server-authoritative Convex code from stored order refs.
- [ ] Future Kaskade server-authoritative action.
- [x] Stripe Terminal sale-ref PaymentIntent action and Next route.
- [x] Primary `/checkout` frontend cutover to Convex order refs and Stripe action route, with payment gated until envs exist.
- [x] Native `/pos` draft review route that server-prices POS carts without
      live Terminal capture; `/pos-next` remains as a compatibility URL for the
      same shell.
- [x] Disable `/checkout.html` legacy Stripe card fallback in the Vercel-served compatibility page.
- [x] Replace `/checkout.html` with a handoff-only compatibility page and stop
      shipping the legacy checkout script/stylesheet in `apps/web/public`.
- [ ] Deploy/disable old Supabase payment functions in the Supabase dashboard so any previously deployed legacy functions stop accepting browser totals.
- [x] Server-driven POS Terminal reader processing code from stored `saleRef` only.
- [x] Stripe Terminal final webhook reconciliation from stored `saleRef` and stored Terminal payment events only.
- [ ] Real POS Terminal test-reader acceptance with linked Convex, Vercel envs, Stripe dashboard webhook endpoint, and seeded staff.
- [x] Cut public `/members` over to the native application path with a
      fail-closed server submission contract. Linked Convex/Vercel envs are
      still required before real application acceptance succeeds in production.
- [x] Cut public `/experiences` over to the native inquiry path with a
      fail-closed server submission contract. Linked Convex/Vercel envs are
      still required before real inquiry acceptance succeeds in production.
- [x] Reduced public content `.html` compatibility files to handoff pages for
      `/about`, `/cafe`, `/experiences`, `/members`, `/privacy`, and `/terms`,
      and removed the old public page CSS/navigation script assets from
      `apps/web/public`.
- [ ] Admin/POS protected App Router rebuild. Native `/admin` has a
      staff-authenticated operations snapshot, front-desk booking
      lookup/check-in, audited booking/member status actions, typed
      announcement/hours config, native voucher redemption, and admin-only CSV
      exports. PR #121 replaces pasted UI tokens with Clerk, but dashboard
      setup and linked acceptance remain pending. Native `/pos` owns
      the extensionless POS shell and staff-gated Terminal reader selector;
      pricing/menu/catalog/delete/refund workflows and live Stripe Terminal
      test-reader acceptance still remain.
      The legacy `/admin.html` and `/pos.html` staff apps have now been retired
      to native handoff pages, and the old `shared-data.js`, `admin.js`, and
      `pos.js` assets are gone from `apps/web/public`.
- [x] Confirm GitHub Pages dashboard/source state after code-side root static cleanup.
- [ ] Disable old Supabase functions/storage after migration.

### 2026-07-06 PR #92 Production Evidence

- [x] Merged live Supabase retirement smoke PR #92 into `main` as merge commit
      `0f46dc4089afc59c92aa2b5d9da28b239c7d92d3`.
- [x] Confirmed Vercel production deployment from PR #92 is READY:
      `https://web-4keycalzp-junyen-enterprises.vercel.app`
      (`dpl_5Dj4vhM6cVYJ14HVeAXqecaNKwb2`), with `skydeckla.com` and
      `www.skydeckla.com` still serving through the Vercel project.
- [x] Ran `SMOKE_BASE_URL=https://skydeckla.com bun run test:smoke`; the
      23-route matrix passed.
- [x] Ran `PAYMENT_SMOKE_BASE_URL=https://skydeckla.com bun run test:payments`;
      checkout returned canonical `8505` cents, POS returned canonical `9700`
      cents, and Stripe execution routes failed closed without real
      Convex/Stripe dashboard wiring or POS Terminal acceptance.
- [x] Ran `SMOKE_BASE_URL=https://skydeckla.com bun run test:production-readiness`;
      both `skydeckla.com` and `www.skydeckla.com` passed route/noindex,
      no-write payment, member, experience, admin, POS, and compatibility
      checks.
- [x] Queried Vercel runtime evidence after the smoke probes: no grouped
      runtime errors and no error/fatal logs for
      `dpl_5Dj4vhM6cVYJ14HVeAXqecaNKwb2` in the checked 30-minute window.
      Observed `401` and `503` production responses matched expected staff-auth
      and Convex-unconfigured gates.
- [x] Ran dependency/security checks after PR #92: `bun run check`, `bun run
      security`, `bun audit --audit-level=low`, `bun outdated`, direct registry
      checks for core runtime packages, and `bun update --latest --dry-run`.
      No safe dependency patch was needed; ESLint 10 remains deferred until the
      Next lint plugin stack has compatible peer ranges.

### 2026-07-06 Dashboard Readiness Audit

- [x] Fixed linked acceptance so optional Stripe Checkout and Terminal reader
      tests reuse the original stored checkout/POS draft idempotency keys.
      This keeps payment creation tied to the server-owned draft contract.
- [x] Hardened Checkout webhook reconciliation so a late failed/canceled event
      after an order is already paid records a failed webhook audit event but
      does not insert a contradictory failed/canceled payment event.
- [x] Kept the Stripe API version intentionally pinned to
      `2026-02-25.clover` and documented that Stripe's current
      `2026-06-24.dahlia` version should be adopted only in a controlled
      Workbench/webhook endpoint upgrade with linked acceptance evidence.
- [x] Updated current-state docs and dashboard checklists: latest Vercel
      production evidence is PR #94 / `dpl_3gB3pRz1WzEJ9xB4Mn3btSMgdqXf`,
      Terminal acceptance is a temporary latch instead of a default env step,
      and Supabase retirement now has a dashboard procedure.
- [x] Verified Vercel hosting health: production deployment
      `dpl_3gB3pRz1WzEJ9xB4Mn3btSMgdqXf` is READY, aliased to
      `skydeckla.com` and `www.skydeckla.com`, with no grouped runtime errors
      and no error/fatal logs in the checked post-merge window.
- [x] Confirmed Vercel project envs are still absent with
      `vercel env ls --scope junyen-enterprises`; payment execution remains
      intentionally fail-closed until dashboard setup is complete.
- [x] Re-ran `bun run check`, `bun run security`, `bun audit --audit-level=low`,
      `bun outdated`, `bun update --latest --dry-run`, `bun run test:smoke`,
      `bun run test:payments`, and `bun run test:production-readiness`.
      No dependency upgrade was needed and live production smokes still passed.
- [x] Re-ran Helium/Computer Use visual QA on July 6, 2026. Production
      `/admin`, `/pos`, and `/pos-next` render readable white text on black
      staff surfaces; `apps/web/staff-contrast.test.ts` continues to guard this
      contrast in automated tests.

### 2026-07-06 PR #94 Production Evidence

- [x] Merged dashboard-readiness PR #94 into `main` as merge commit
      `a5027bdaeb311c1eed938560b0a77590ed9439b4`.
- [x] Confirmed Vercel production deployment from PR #94 is READY:
      `https://web-iwfcnvi0b-junyen-enterprises.vercel.app`
      (`dpl_3gB3pRz1WzEJ9xB4Mn3btSMgdqXf`), with `skydeckla.com` and
      `www.skydeckla.com` aliased to the same deployment.
- [x] Ran `SMOKE_BASE_URL=https://skydeckla.com bun run test:smoke`; the
      23-route matrix passed.
- [x] Ran `PAYMENT_SMOKE_BASE_URL=https://skydeckla.com bun run test:payments`;
      checkout returned canonical `8505` cents, POS returned canonical `9700`
      cents, and Stripe execution routes failed closed without real
      Convex/Stripe dashboard wiring or POS Terminal acceptance.
- [x] Ran `SMOKE_BASE_URL=https://skydeckla.com bun run test:production-readiness`;
      both `skydeckla.com` and `www.skydeckla.com` passed route/noindex,
      no-write payment, member, experience, admin, POS, and compatibility
      checks.
- [x] Queried Vercel runtime evidence after the smoke probes: no grouped
      runtime errors and no error/fatal logs for
      `dpl_3gB3pRz1WzEJ9xB4Mn3btSMgdqXf`. Status-code grouping showed expected
      successful `200` responses plus expected `401` staff-auth and `503`
      Convex-unconfigured gates.

### 2026-07-06 Vercel Env Readiness Checker

- [x] Added `bun run vercel:env:check`, a safe Vercel dashboard verifier that
      reads `vercel env ls --format json` for the linked `apps/web` project and
      reports env names/scopes only.
- [x] The checker fails until `NEXT_PUBLIC_CONVEX_URL` exists in Preview and
      Production, and it fails if Stripe, staff bootstrap, or Terminal secrets
      are placed in Vercel instead of Convex.
- [x] Added fixture-based tests for empty-dashboard, ready, and misplaced-secret
      states so the command can be verified without hitting the real Vercel
      dashboard.

### 2026-07-06 PR #96 Production Evidence

- [x] Merged Vercel-env-readiness PR #96 into `main` as merge commit
      `65bb2a6e38eed1474cf809586ef427b57af9b196`.
- [x] Confirmed Vercel production deployment from PR #96 is READY:
      `https://web-4jgzocjsd-junyen-enterprises.vercel.app`
      (`dpl_A9RsQBhPHNxPWKj3e3QPm4G325TS`), with `skydeckla.com` and
      `www.skydeckla.com` aliased to the same deployment.
- [x] Ran `SMOKE_BASE_URL=https://skydeckla.com bun run test:smoke`; the
      23-route matrix passed.
- [x] Ran `PAYMENT_SMOKE_BASE_URL=https://skydeckla.com bun run test:payments`;
      checkout returned canonical `8505` cents, POS returned canonical `9700`
      cents, and Stripe execution routes failed closed without real
      Convex/Stripe dashboard wiring or POS Terminal acceptance.
- [x] Ran `SMOKE_BASE_URL=https://skydeckla.com bun run test:production-readiness`;
      both `skydeckla.com` and `www.skydeckla.com` passed route/noindex,
      no-write payment, member, experience, admin, POS, and compatibility
      checks.
- [x] Queried Vercel env state with the new checker. The real
      `junyen-enterprises/web` project still has `envCount: 0`, so
      `readyForConvexUrl` is false while `safeSecretPlacement` is true.
- [x] Queried Vercel runtime evidence after the smoke probes: no grouped
      runtime errors and no error/fatal logs for
      `dpl_A9RsQBhPHNxPWKj3e3QPm4G325TS`. Status-code grouping showed expected
      successful `200` responses plus expected `401` staff-auth and `503`
      Convex-unconfigured gates.

### 2026-07-06 Dashboard Readiness Summary

- [x] Added `bun run dashboard:readiness`, a safe aggregate dashboard verifier
      that runs the existing Convex and Vercel env checks, reports no secret
      values, and emits one JSON status for humans and agents.
- [x] The command fails until linked Preview no-write preflight has the minimum
      dashboard shape: Vercel `NEXT_PUBLIC_CONVEX_URL` in Preview/Production,
      no misplaced Vercel payment/staff secrets, cloud Convex persistence,
      Stripe Checkout envs, and Stripe webhook envs.
- [x] The output includes ordered `nextActions` for dashboard work and keeps
      `safeToUseRealCards: false` so test-mode acceptance cannot be confused
      with live-card readiness.

### 2026-07-06 Admin Catalog Readiness

- [x] Added native `/admin` controls for admin-only code-owned catalog seeding
      and version activation through `/api/admin/catalog`.
- [x] Kept browser price editing out of the staff UI: catalog actions send only
      `action`, optional `version`, and optional `note`, while the API still
      rejects `products` or `prices` payloads before calling Convex.
- [x] Tightened Convex catalog activation so the current `products` mirror
      deletes product keys omitted from the active snapshot; immutable
      `productSnapshots` keep the history.
- [x] Added focused tests for the admin catalog UI contract and catalog content
      hashing/stale-key detection.
- [x] Merged admin catalog readiness PR #100 into `main` as merge commit
      `840ceec1fd7ca93e952221fa01c43288ebcfbfbd`.
- [x] Confirmed Vercel production deployment from PR #100 is READY:
      `https://web-lk4atrfwh-junyen-enterprises.vercel.app`
      (`dpl_7vV4SCyfrvrukWRtLWuNj2WKudW9`), aliased to `skydeckla.com` and
      `www.skydeckla.com`.
- [x] Re-ran route, payment, and production-readiness smokes against
      `https://skydeckla.com`; all passed, payment probes returned checkout
      total `8505` cents and POS total `9700` cents, and Stripe execution stayed
      fail-closed while Convex/Stripe dashboard envs are absent.
- [x] Queried Vercel error logs for `dpl_7vV4SCyfrvrukWRtLWuNj2WKudW9`; no
      error logs were found in the checked 30-minute window.

### 2026-07-06 Catalog Line Provenance

- [x] Added `@skyla/payments` catalog line provenance helpers that stamp
      catalog-priced checkout and POS lines with catalog version, source,
      authority, and deterministic product content hash metadata.
- [x] Kept runtime pricing authority on `@skyla/payments`; custom POS charges
      keep only the staff-entered reason and do not claim catalog provenance.
- [x] Added route, payment-helper, Convex persistence, and Convex catalog parity
      tests so browser-supplied metadata is ignored and line hashes match the
      code-owned catalog snapshots.
- [x] Merged catalog line provenance PR #101 into `main` as merge commit
      `0c8f3b3045014e888e9ee70c097aece94fcc6eb7`.
- [x] Confirmed Vercel production deployment from PR #101 is READY:
      `https://web-ho5ezap7w-junyen-enterprises.vercel.app`
      (`dpl_9FL97JyfdrxfTesT3CnNmbvR4wNy`), aliased to `skydeckla.com` and
      `www.skydeckla.com`.
- [x] Re-ran post-merge route and payment smokes on the raw Vercel production
      URL and `https://skydeckla.com`; all passed with checkout total `8505`
      cents, POS total `9700` cents, and Stripe execution still fail-closed
      before Convex/Stripe dashboard wiring.
- [x] Re-ran `SMOKE_BASE_URL=https://skydeckla.com bun run
      test:production-readiness`; apex and `www` passed.
- [x] Queried Vercel error logs for `dpl_9FL97JyfdrxfTesT3CnNmbvR4wNy`; no
      error logs were found in the checked 30-minute window.
- [x] Started branch `codex/acceptance-provenance-gates` to move the line
      provenance contract into the reusable no-write payment/readiness smokes.
- [x] Added script-level tests for `scripts/smoke/payment-api-smoke.mjs` so the
      smoke fails when catalog-priced draft lines omit provenance or custom POS
      lines reflect browser-supplied catalog metadata.
- [x] Tightened the shared smoke provenance helper to assert exact product
      hashes, quantities, unit amounts, and line totals for checkout and POS
      probes.
- [x] Added the same provenance gate to linked acceptance so persisted
      checkout/POS draft readbacks are checked before optional Stripe Checkout
      or Terminal reader legs.
- [x] Merged acceptance provenance gates PR #103 into `main` as merge commit
      `2758335f507d64b0bdaaf7c7350d0626ae78c0b8`.
- [x] Confirmed Vercel production deployment from PR #103 is READY:
      `https://web-powem7zir-junyen-enterprises.vercel.app`
      (`dpl_71pvfCSSG6WMYRVFcivpVi4jQ9SF`), aliased to `skydeckla.com` and
      `www.skydeckla.com`.
- [x] Re-ran route and payment smokes on the raw Vercel production URL and
      `https://skydeckla.com`; all passed with checkout total `8505` cents,
      POS total `9700` cents, exact catalog provenance checks, and Stripe
      execution still fail-closed before Convex/Stripe dashboard wiring.
- [x] Re-ran `SMOKE_BASE_URL=https://skydeckla.com bun run
      test:production-readiness`; apex and `www` passed with the new
      provenance gate.
- [x] Queried Vercel error logs for `dpl_71pvfCSSG6WMYRVFcivpVi4jQ9SF`; no
      error logs were found in the checked 30-minute window.
- [x] Started branch `codex/payment-snapshot-provenance-gate` to close the
      remaining replay gap where Stripe Checkout, Terminal PaymentIntent
      creation, and Terminal reader processing validated stored amounts but did
      not re-check stored catalog provenance before handoff.
- [x] Added `assertStoredPaymentLineProvenance` and wired it into the Convex
      payment snapshot queries so catalog-priced lines must still match the
      code-owned catalog version/source/authority/hash and amount, while custom
      POS lines must not spoof catalog metadata.
- [x] Added Convex unit coverage proving Checkout snapshots reject missing
      provenance and Terminal reader processing rejects spoofed catalog hashes.
- [x] Re-ran `bun run check`, `bun run security`, live payment smoke, and
      production-readiness smoke against `https://skydeckla.com`; all passed,
      with production still fail-closed before dashboard wiring.
- [x] Merged payment snapshot provenance gate PR #105 into `main` as merge
      commit `3648ee4e4c5b99d4e31639650a620f7fb729ff80`.
- [x] Confirmed Vercel production deployment from PR #105 is READY:
      `https://web-d3k2cd65i-junyen-enterprises.vercel.app`
      (`dpl_HmrWjRmM3jt5kEpt5oqwQrUzjyAX`), aliased to `skydeckla.com` and
      `www.skydeckla.com`.
- [x] Re-ran route and payment smokes on the raw Vercel production URL and
      `https://skydeckla.com`; all passed with checkout total `8505` cents,
      POS total `9700` cents, exact catalog provenance checks, and Stripe
      execution still fail-closed before Convex/Stripe dashboard wiring.
- [x] Re-ran `SMOKE_BASE_URL=https://skydeckla.com bun run
      test:production-readiness`; apex and `www` passed after PR #105.
- [x] Queried Vercel error logs for `dpl_HmrWjRmM3jt5kEpt5oqwQrUzjyAX`; no
      error logs were found in the checked 30-minute window.

### 2026-07-06 PR #106 Production And Governance Evidence

- [x] Merged post-PR #105 production-evidence docs PR #106 into `main` as merge
      commit `daa7605cc2cf586b94e51c069c427cc0d5f67601`.
- [x] Confirmed the PR #106 Vercel production alias was READY:
      `https://web-5nzoujeod-junyen-enterprises.vercel.app`
      (`dpl_59RHYSuQhkBar871iwErMPrZMsRM`), aliased to `skydeckla.com` and
      `www.skydeckla.com`.
- [x] Re-ran custom-domain route, payment, and production-readiness smokes
      after PR #106; all passed with production still fail-closed before
      Convex/Stripe dashboard wiring.
- [x] Queried Vercel error logs after the PR #106 smoke probes; no error logs
      were found in the checked window.
- [x] Rechecked GitHub governance on July 6, 2026: `main` branch protection is
      strict for `ci-build`, `Analyze JavaScript and TypeScript`, and `Vercel`;
      admins are enforced; force pushes and branch deletion are disabled;
      conversation resolution is required; Dependabot vulnerability alerts and
      automated security fixes are enabled.

### 2026-07-06 PR #107 Production Evidence

- [x] Merged Terminal reader readiness and governance PR #107 into `main` as
      merge commit `704bcbe03c2c5c49e0443443d99cfca70d95f550`.
- [x] Tightened Terminal PaymentIntent readiness after a payment/API audit:
      Convex now rejects Terminal PaymentIntent snapshots before Stripe when
      the stored POS sale has no trusted reader, instead of letting reader
      processing fail later.
- [x] Confirmed Vercel production deployment from PR #107 is READY:
      `https://web-kafot1r2n-junyen-enterprises.vercel.app`
      (`dpl_3Z4G1ePhontznWGYcfWGXfCCJCc9`), aliased to `skydeckla.com` and
      `www.skydeckla.com`.
- [x] Re-ran `SMOKE_BASE_URL=https://skydeckla.com bun run test:smoke`; the
      23-route matrix passed.
- [x] Re-ran `PAYMENT_SMOKE_BASE_URL=https://skydeckla.com bun run
      test:payments`; checkout returned canonical `8505` cents, POS returned
      canonical `9700` cents, exact catalog provenance checks passed, and Stripe
      execution still failed closed before Convex/Stripe dashboard wiring.
- [x] Re-ran `SMOKE_BASE_URL=https://skydeckla.com bun run
      test:production-readiness`; apex and `www` passed after PR #107.
- [x] Queried Vercel error logs for `dpl_3Z4G1ePhontznWGYcfWGXfCCJCc9`; no
      error logs were found in the checked 20-minute window.

### 2026-07-07 PR #109 Turbo/Bun Production Evidence

- [x] Merged Dependabot Turbo PR #109 into `main` as merge commit
      `c328c0b46972a1db4a72c69af6cfd8f45ae1087c`.
- [x] Upgraded local Bun canary to `1.4.0-canary.1+1de77f961`, ran
      `bun install --frozen-lockfile`, and confirmed no repo changes.
- [x] Ran `bun run check` with Turbo `2.10.4`; all lint, typecheck, tests,
      build, Convex typechecks, and artifact/Supabase-retirement guards passed.
      The old `Unsupported bun lockfile version: 2` warning did not appear.
- [x] Ran `bun run security`; tracked-artifact, Supabase-retirement, and
      `bun audit --audit-level=high` checks passed with no vulnerabilities.
- [x] Ran `bun outdated --recursive`; only the deferred `eslint@10.6.0` major
      remains.
- [x] Confirmed Vercel production deployment from `main` is READY:
      `https://web-r9k93t62a-junyen-enterprises.vercel.app`
      (`dpl_6cUtqRMRAu4AegFnGK7BmjvS3X59`), aliased to `skydeckla.com` and
      `www.skydeckla.com`.
- [x] Re-ran `SMOKE_BASE_URL=https://skydeckla.com bun run test:smoke`;
      23 routes passed on the apex domain.
- [x] Re-ran `PAYMENT_SMOKE_BASE_URL=https://skydeckla.com bun run
      test:payments`; checkout and POS totals remained server-owned, exact
      catalog provenance checks passed, no real Stripe charge was attempted,
      and Stripe execution routes stayed fail-closed before real
      Convex/Stripe dashboard wiring.
- [x] Re-ran `PRODUCTION_READINESS_BASE_URLS=https://skydeckla.com,https://www.skydeckla.com
      VERCEL_PRODUCTION_URL=https://web-r9k93t62a-junyen-enterprises.vercel.app
      bun run test:production-readiness`; apex, `www`, and the production
      deployment URL passed.
- [x] Queried Vercel logs for deployment
      `dpl_6cUtqRMRAu4AegFnGK7BmjvS3X59`; no logs were found after the smoke
      probes.

### 2026-07-07 PR #110 And Vercel Project-Shape Readiness

- [x] Merged current-state docs PR #110 into `main` as merge commit
      `168f773791267d8796e22126dbf19443d201716b`.
- [x] Confirmed the latest Vercel production deployment is READY:
      `https://web-5o94djb5w-junyen-enterprises.vercel.app`
      (`dpl_E4sGPBq4gn8Mdhwt1ApJFWfau7Ko`), aliased to `skydeckla.com` and
      `www.skydeckla.com`.
- [x] Added `bun run vercel:project:check`, a non-secret drift checker for the
      Vercel project shape. It verifies the project ID/name, root `apps/web`,
      Next.js framework, Node `24.x`, optional local `.vercel` link, and the
      committed `apps/web/vercel.json` Bun canary install/build commands.
- [x] Updated `bun run dashboard:readiness` so it includes
      `vercelProjectShape: true` before linked Preview acceptance can be
      considered ready.
- [x] Documented the dashboard/build-command nuance: Vercel project settings
      may display default command labels, while `apps/web/vercel.json`
      remains the deployment build authority for Bun canary.
- [ ] Vercel envs still need `NEXT_PUBLIC_CONVEX_URL`, and Convex still needs
      cloud, Stripe, staff, webhook, and Terminal reader env setup before real
      card or reader acceptance.

### 2026-07-07 PR #111 Production Evidence

- [x] Merged Vercel project-shape readiness PR #111 into `main` as merge
      commit `0ac3c6f96a4ba19c46bee7c2682c2cc9970d7272`.
- [x] Confirmed Vercel production deployment from PR #111 is READY:
      `https://web-hqavd3ofq-junyen-enterprises.vercel.app`
      (`dpl_3wuM3SNqjnN44PR3VuPQYFZBuoBf`), aliased to `skydeckla.com` and
      `www.skydeckla.com`.
- [x] Re-ran `SMOKE_BASE_URL=https://skydeckla.com bun run test:smoke`;
      23 routes passed on the apex domain.
- [x] Re-ran `PAYMENT_SMOKE_BASE_URL=https://skydeckla.com bun run
      test:payments`; checkout and POS totals remained server-owned, exact
      catalog provenance checks passed, no real Stripe charge was attempted,
      and Stripe execution routes stayed fail-closed before real
      Convex/Stripe dashboard wiring.
- [x] Re-ran `PRODUCTION_READINESS_BASE_URLS=https://skydeckla.com,https://www.skydeckla.com
      VERCEL_PRODUCTION_URL=https://web-hqavd3ofq-junyen-enterprises.vercel.app
      bun run test:production-readiness`; apex, `www`, and the production
      deployment URL passed.
- [x] Re-ran `bun run vercel:project:check`; Vercel project shape remains
      aligned with `junyen-enterprises/web`, root `apps/web`, Next.js, Node
      `24.x`, and the repo-owned Bun canary commands.
- [x] Re-ran `bun run dashboard:readiness`; it now reports
      `vercelProjectShape: true` and still fails closed because Vercel envs
      and Convex/Stripe/staff/Terminal dashboard envs are absent.
- [x] Queried Vercel runtime logs after the smoke probes; no `error` or
      `fatal` logs were found in the checked 30-minute production window.

### 2026-07-07 PR #112 Production Evidence

- [x] Merged PR #112 into `main` as merge commit
      `8150de2becc3b24c8a20da6c828a1873061a3ff6`.
- [x] Confirmed Vercel production deployment from PR #112 is READY:
      `https://web-3oity7xei-junyen-enterprises.vercel.app`
      (`dpl_HYqCZRkedqtEdyuaPsbHGHBHA8uA`), aliased to `skydeckla.com` and
      `www.skydeckla.com`.
- [x] Re-ran `SMOKE_BASE_URL=https://skydeckla.com bun run test:smoke`;
      23 routes passed on the apex domain.
- [x] Re-ran `PAYMENT_SMOKE_BASE_URL=https://skydeckla.com bun run
      test:payments`; checkout and POS totals remained server-owned, exact
      catalog provenance checks passed, no real Stripe charge was attempted,
      and Stripe execution routes stayed fail-closed before real
      Convex/Stripe dashboard wiring.
- [x] Re-ran `PRODUCTION_READINESS_BASE_URLS=https://skydeckla.com,https://www.skydeckla.com
      VERCEL_PRODUCTION_URL=https://web-3oity7xei-junyen-enterprises.vercel.app
      bun run test:production-readiness`; apex, `www`, and the production
      deployment URL passed.
- [x] Re-ran `bun run vercel:project:check`; Vercel project shape remains
      aligned with `junyen-enterprises/web`, root `apps/web`, Next.js, Node
      `24.x`, and the repo-owned Bun canary commands.
- [x] Re-ran `bun run dashboard:readiness`; it reports
      `vercelProjectShape: true` and still fails closed because Vercel envs
      and Convex/Stripe/staff/Terminal dashboard envs are absent.
- [x] Queried Vercel runtime logs after the smoke probes; no `error` or
      `fatal` logs were found in the checked 30-minute production window.

### 2026-07-07 Payment Header And Contrast Follow-Up

- [x] Added `Cache-Control: no-store` to public payment API responses.
- [x] Added `Vary: Authorization` to staff-gated Stripe Terminal start/process
      responses.
- [x] Sanitized payment-route catch responses so raw Stripe/Convex/provider
      messages and env names are not returned to browsers.
- [x] Mapped authenticated-but-not-allowed staff role failures to `403` with a
      stable public `staff_forbidden` code.
- [x] Extended `bun run test:payments` to check the no-store/Vary payment
      headers and the generic fail-closed payment error code.
- [x] Extended POS contrast coverage so POS headings stay white on black staff
      surfaces.

### 2026-07-12 App Router Ownership And Dependency Audit

- [x] Rechecked `origin/main` from a clean worktree; PR #113 is deployed at
      `https://web-5whdulzh0-junyen-enterprises.vercel.app` with Vercel status
      `READY`, production aliases attached, and no grouped runtime errors in
      the checked seven-day window.
- [x] Rechecked GitHub governance: `main` still requires strict `ci-build`,
      `Analyze JavaScript and TypeScript`, and `Vercel`; secret scanning and
      push protection are enabled; GitHub Pages remains disabled.
- [x] Upgraded local Bun canary to `1.4.0-canary.1+2e2230a81`. CI and Vercel
      intentionally follow the moving canary channel, so every build must keep
      printing `bun --revision` and canary changes require full verification.
- [x] Upgraded `@types/node` from `26.1.0` to `26.1.1`.
- [x] Tested TypeScript `7.0.2` across every project config. Direct typechecks
      pass, but Next.js `16.2.10` rejects it during `next build`; production
      remains on TypeScript `6.0.3` until Next supports the major.
- [x] Replaced nine static `.html` handoff documents with centralized permanent
      Next.js redirects in `apps/web/site-routes.mjs`.
- [x] Moved `robots.txt` and `sitemap.xml` ownership into App Router metadata
      routes backed by the same route registry.
- [x] Updated route, readiness, and artifact guards so redirects preserve query
      strings, staff routes remain noindex, and retired static files cannot
      return.
- [x] Changed GitHub CI to run the complete `bun run security` gate, including
      the retired-Supabase guard that was previously omitted by the workflow.
- [x] Paid Stripe Checkout reconciliation now creates exactly one confirmed
      booking from stored fulfillment fields in the same Convex mutation, with
      same-event and different-event replay coverage.
- [x] Checkout now stores `HH:mm` entry times instead of sending display labels
      such as `2:00 PM`, and requires a valid guest email before order review.
- [x] Added a minimal non-cacheable Checkout return-status API keyed by the
      Stripe Checkout Session ID and backed by its server-created payment event; the
      return UI now polls Convex and confirms only when paid ledger, paid order,
      and booking agree.
- [ ] Prove booking fulfillment against the linked Convex project and a signed
      Stripe test webhook before any card acceptance.
- [ ] No Skyla Convex cloud project is visible to the currently authenticated
      local Convex account; project creation/linking remains a dashboard step.

### 2026-07-12 PR #117 Legacy Data Migration Preparation

- [x] Merged PR #117 as
      `e5973048ea3f5ce3c577eb979232cd520a577407` after CI, CodeQL, and Vercel
      checks passed.
- [x] Verified READY production deployment
      `https://web-kyy17u2k9-junyen-enterprises.vercel.app`
      (`dpl_FNptKigyVuVBFSf8bD4XXsHZ8Thm`).
- [x] Passed post-merge readiness on apex, `www`, and immutable production,
      plus route/payment smokes on apex; Vercel reported no runtime errors in
      the checked 30-minute window.
- [ ] Repeat the visual staff pass in Helium after the Mac is unlocked. The
      automated white-on-black staff contrast test passed.
- [x] Added a narrowly scoped legacy migration implementation for Supabase
      `bookings`, `members`, and `inquiries`, with deterministic SHA-256 plans,
      quarantine, 1-50 row batches, stable source identities, batch/row ledgers,
      summary reconciliation, and conservative per-batch rollback.
- [x] Kept historical bookings separate from canonical orders and payment
      events. The migration excludes config, Supabase Auth/passwords, orders,
      POS sales, and payment/webhook ledgers.
- [x] Changed the operator CLI to use `ConvexHttpClient` over an explicit HTTPS
      Convex URL, so PII and the temporary migration token are not placed in
      process arguments. Remote commands still require an explicit deployment
      label; every remote apply and rollback requires `--confirm-production`
      because the Convex URL does not identify its environment.
- [x] Documented verified physical-table export SQL for `id`, `data`, and
      `created_at`, immutable source/timestamp/SHA controls, private review
      artifacts, development-first apply, reconciliation, rollback, production
      confirmation, token removal, read-only Supabase retention, and separate
      localStorage recovery.
- [ ] Export the real Supabase source and resolve every quarantined row.
- [ ] Apply and reconcile the reviewed plan on a linked Convex development
      deployment.
- [ ] Record human production approval, apply the exact reviewed plan with
      `--confirm-production`, reconcile it, and remove the temporary token.
- [ ] Keep Supabase read-only for the agreed retention window after production
      reconciliation. No cloud data migration has occurred yet.

## Decisions

- Keep duplicate legacy static files out of the root and `apps/web/public`;
  saved-link compatibility belongs in the Next route registry.
- Keep the tracked artifact guard enforcing that old root static files, root
  `images/`, `CNAME`, and root compatibility scripts/styles do not return.
- Use `apps/web` as the Vercel project root.
- Use Clerk for human staff authentication while Convex `staffUsers` and
  `requireStaffUser` remain role authority. Keep bearer auth for controlled
  automation, and keep all staff workflows fail closed when Clerk/Convex envs
  are incomplete.
- Preserve legacy URLs with centralized Next.js redirects while App Router owns
  the actual pages.
- Do not commit or deploy `output/` or `tmp/`.
- Use previous Vercel deployments as the hosting rollback path; do not treat root GitHub Pages files as the active rollback path after cleanup merges.
- Treat `bun run check`, `bun run security:audit`, `bun run security:artifacts`, and custom-domain smoke tests as the minimum baseline before merging migration PRs.
- Use `bun run test:payments` as the public payment/API safety smoke while
  production is expected to fail closed before real Convex/Stripe dashboard
  wiring.
- Use `bun run test:acceptance:linked` only after Convex/Vercel envs and seeded
  test staff exist. It writes test records, expects the remote backend to report
  `SKYLA_STRIPE_MODE=test`, and refuses non-preview targets unless the operator
  explicitly allows production acceptance.
- Public member applications should follow the same fail-closed rule as payment
  execution: no "application received" success on the native path unless Convex
  accepted the mutation.
- Public experience inquiries should follow the same fail-closed rule as
  payment execution: no "request received" success on the native path unless
  Convex accepted the mutation.
- `/privacy` and `/terms` are native App Router pages. Keep their saved `.html`
  paths as centralized redirects while legacy links still need them.
- `/about` and `/cafe` should be native App Router pages. The native cafe page
  renders active menu items from `@skyla/payments` so public prices align with
  checkout/POS server-owned catalog data instead of browser localStorage.
- Saved `.html` compatibility belongs in `apps/web/site-routes.mjs`. Do not
  reintroduce public compatibility documents, page-level CSS, or shared
  navigation scripts once App Router owns the content.

## Risks To Track

- Current local working tree includes unrelated pre-existing content edits. Do not revert them.
- The first Vercel CLI deployment was built from a dirty local worktree because legacy root files are modified locally. Use a clean Git-triggered deployment as the cutover candidate.
- Old root and public compatibility pages have been removed from the active
  tree; saved paths are handled by centralized Next.js redirects.
- GitHub Pages was disabled after Vercel custom-domain verification; use Vercel
  rollback instead of `github.io` hosting.
- Historical note: the GitHub Pages project URL redirected through the repository `CNAME` before this cleanup branch removed that file, so it was not a clean fallback after DNS cutover without Pages custom-domain changes.
- Vercel/domain setup may require browser login or user confirmation before cloud-side changes.
- Immediately after the nameserver cutover, this Mac's system resolver returned stale GitHub Pages behavior even while authoritative/external DNS and Vercel verification were correct. The later custom-domain smoke tests now pass on apex and `www`; keep this note for future DNS investigations.
- Payment/auth/data migration must not be done as a cosmetic rewrite; server authority is the main security requirement.
- Paid Checkout booking fulfillment is now atomic and replay-safe in local code.
  Keep card acceptance disabled until the linked Convex/Stripe test-mode run
  proves the signed webhook creates one booking and replay creates no duplicate.
- Retired July 7, 2026: the Bun/Turbo lockfile warning no longer appears after
  Turbo `2.10.4` and the current text `bun.lock`. Keep future Bun canary
  lockfile-format changes visible in focused dependency PRs.
- Google Ads conversion tracking is still a transition bridge, but checkout,
  members, and experience lead routes are now native App Router pages. Replace
  the public helper with a typed analytics integration once dashboard wiring and
  acceptance are stable.
- Shipped code creates Stripe Terminal PaymentIntents from stored `saleRef`
  records only. Native `/pos` has replaced the extensionless legacy POS route.
  PR #121 adds Clerk UI authentication, but live reader collection
  still needs Clerk/Convex/Vercel dashboard setup, linked acceptance, and
  Stripe test-reader acceptance before staff should use card-present payment.
- The reader-processing work adds server-driven reader processing for stored POS sales. Reader handoff still stays non-final; signed Stripe `payment_intent.succeeded`, `payment_intent.payment_failed`, and `payment_intent.canceled` webhooks now reconcile the stored sale against `saleRef`, Terminal PaymentIntent ID, amount, currency, and webhook idempotency.
- The real Convex cloud project is still not linked in this worktree or wired into production Vercel. Current validation uses `CONVEX_AGENT_MODE=anonymous bunx convex dev --once --typecheck enable` until the real deployment exists.
- Stripe Checkout session creation and webhook reconciliation now exist in Convex code, and the primary `/checkout` UI is wired to the Next/Convex bridge. Live card payment is still gated until real Convex/Stripe envs and Stripe dashboard endpoint setup are complete.
- Repository copies of legacy Supabase Stripe Checkout, Terminal charge
  creation, Kaskade payment creation, and Kaskade webhook handling now return
  `410` permanently where they could affect payment state. The checkout copy
  also returns `410` for old Checkout session verification. This does not change
  any already deployed Supabase function until it is redeployed or disabled in
  the Supabase dashboard.
- The production native `/admin` path now has front-desk booking
  lookup/check-in, audited status actions, announcement/hours config, native
  voucher redemption, and read-only signed refund reconciliation, but
  still intentionally excludes refund initiation, automatic booking
  cancellation, hard deletes, bulk clears, reset-all settings, and
  pricing/menu/catalog mutations until typed validators, reconciliation rules,
  and rollback procedures exist.
- Branch `codex/native-pos-route-cutover` moves extensionless `/pos` from the
  legacy rewrite bridge to the native server-priced POS shell, keeps `/pos-next`
  as a compatibility URL, and originally left `/pos.html` as the explicit
  disabled legacy fallback. A later staff fallback retirement branch turns
  `/pos.html` into a native handoff instead. Live card-present payment remains
  blocked until real Convex/staff auth/Stripe webhook/test-reader acceptance is
  complete.
- PR #62 merged the native `/pos` route cutover into `main`. Production
  readiness and no-write payment smokes passed on
  `https://web-g6cp2p7an-junyen-enterprises.vercel.app`,
  `https://skydeckla.com`, and `https://www.skydeckla.com`; Vercel reported no
  runtime error clusters and no error/fatal logs for deployment
  `dpl_J73keiyGYXdQTtv1NKX3uhW6vDPB` in the checked one-hour window.
