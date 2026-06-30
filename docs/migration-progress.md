# Skyla Migration Progress

This file is the durable scratchpad for the migration. Update it whenever a task starts, finishes, or is deferred.

## Completed Foundation Goal

Finish the Vercel/Turborepo/Next.js foundation, keep the legacy static site recoverable, make the Vercel production deployment route-compatible with current public paths, then cut over `skydeckla.com` only after verification.

## Active Phase 2 Goal

Clean and reorganize the repository around the new Turborepo architecture, adopt Bun canary deliberately, migrate functionality into Next.js and Convex, make docs useful for humans and agents, add meaningful QA/security coverage, and ship through reviewed PRs.

## Current Status

- [x] Verified current production is GitHub Pages from `main` root.
- [x] Verified latest package baseline through npm registry:
  - Next.js `16.2.9`
  - React `19.2.7`
  - Motion `12.42.0`
  - Turbo `2.10.2`
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
- [x] Installed Bun canary locally and verified `1.4.0-canary.1+ffea69ae7`.
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
- [x] Added a guarded `setup-reader` bridge in the legacy Stripe Terminal function requiring `SKYLA_TERMINAL_SETUP_TOKEN`.
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
- [ ] Verify, review, and ship `codex/convex-stripe-checkout-action`.
- [ ] Link the real Convex deployment and replace anonymous local Convex validation with project-linked codegen in a follow-up PR.

## Deferred Until Foundation Is Stable

- [x] Convex generated types and persisted draft mutations.
- [ ] Real Convex cloud deployment link and Vercel env wiring.
- [ ] Convex HTTP webhook actions.
- [ ] Kaskade and Stripe Terminal server-authoritative actions.
- [ ] Live checkout frontend cutover to Convex order refs and Stripe action.
- [ ] Admin/POS rebuild.
- [ ] Confirm GitHub Pages dashboard/source state after code-side root static cleanup.
- [ ] Disable old Supabase functions/storage after migration.

## Decisions

- Remove duplicate legacy static files from the repo root after Vercel custom-domain cutover; keep app-owned compatibility files under `apps/web/public`.
- Use `apps/web` as the Vercel project root.
- Bridge legacy routes from Vercel to static compatibility files during cutover. This is a temporary reliability measure, not the final application architecture.
- Do not commit or deploy `output/` or `tmp/`.
- Use previous Vercel deployments as the hosting rollback path; do not treat root GitHub Pages files as the active rollback path after cleanup merges.
- Treat `bun run check`, `bun run security:audit`, `bun run security:artifacts`, and custom-domain smoke tests as the minimum baseline before merging migration PRs.

## Risks To Track

- Current local working tree includes unrelated pre-existing content edits. Do not revert them.
- The first Vercel CLI deployment was built from a dirty local worktree because legacy root files are modified locally. Use a clean Git-triggered deployment as the cutover candidate.
- Old root static pages have been removed from the active tree; compatibility pages still exist under `apps/web/public`.
- Historical note: the GitHub Pages project URL redirected through the repository `CNAME` before this cleanup branch removed that file, so it was not a clean fallback after DNS cutover without Pages custom-domain changes.
- Vercel/domain setup may require browser login or user confirmation before cloud-side changes.
- Immediately after the nameserver cutover, this Mac's system resolver returned stale GitHub Pages behavior even while authoritative/external DNS and Vercel verification were correct. The later custom-domain smoke tests now pass on apex and `www`; keep this note for future DNS investigations.
- Payment/auth/data migration must not be done as a cosmetic rewrite; server authority is the main security requirement.
- Bun canary currently produces `bun.lock` lockfile version 2, which Turbo `2.10.2` warns it cannot fully parse for lockfile analysis. The task graph still passes, but reviewers should keep this risk visible.
- Google Ads conversion tracking is a transition bridge on the static compatibility pages. The App Router rebuild should replace it with a typed analytics integration once checkout, members, and lead forms are native routes.
- `setup-reader` is now token-gated, but Terminal payment intent creation is still a legacy Supabase function that accepts client totals. Full server authority still requires the Convex/payment PR.
- The real Convex cloud project is still not linked in this worktree or Vercel. This branch uses `CONVEX_AGENT_MODE=anonymous bunx convex dev --once --typecheck enable` for local validation and commits generated types from that local pass.
- Stripe Checkout session creation now exists in Convex code, but it is not live until real Convex/Stripe envs, frontend cutover, and webhook verification are complete.
