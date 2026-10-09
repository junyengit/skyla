# SkyDeck admission sandbox gate

The owner approved implementation and froze delivery to QR → Stripe test payment → phone ticket → staff admission. This phase only allows that test in one isolated backend and a Vercel Preview. Preserve the accepted checkout design. No dashboard polish, homepage work, private-event redesign, production activation, or new dependencies.

## Ground truth

- Adults 18+ $20; ages 8–17 $10; ages 0–7 free. All ages count toward 30 physically inside. Selected Los Angeles day/entry time, same-day validity, no re-entry.
- Individual tickets are allowed. `siteConfig.launched=false` describes current online transaction activation, not whether the venue or normal visits operate.
- Existing checkout and backend public gateway both block purchases while that flag is false. Local preview renders controls but cannot purchase. The original production must remain blocked by that flag during this phase.
- Existing production source: junyengit/skyla at 753d02f. Vercel Junyen Enterprises project web, root apps/web. No provider environment variables, shared variables, or integrations are currently linked there.
- The October 3 isolated Preview grand-ferret-807 is expired and must be rejected. Replacement created October 9 by the official Convex CLI with --type preview and four-day expiry: https://bold-reindeer-495.convex.cloud / https://bold-reindeer-495.convex.site, reference jacobantonioboss:skyla:preview/preview-skydeck-admission-20261009. Pin these URLs finitely in reviewed source; conservative gate cutoff 2026-10-12T04:00:00Z is earlier than the provider expiration. Never modify original Development disciplined-chickadee-688 or Production perceptive-fox-396. The new Preview has no Stripe credentials and no provider test is claimed.
- Core branch excludes parked Billing work and is based on 5a4b5c9. Baseline is now deterministic and passes 1,477 tests.

## Acceptance contract

Add a narrow opt-in bound to the one fresh Preview. Exact environment names are your implementation choice; document them in README.md. Web must require VERCEL=1, VERCEL_ENV=preview, VERCEL_TARGET_ENV=preview, VERCEL_PROJECT_ID=prj_fhlOjcwSbnPAuLi8tTiGbhjVomnr, VERCEL_GIT_COMMIT_REF=codex/skydeck-sandbox-gate-20261003, explicit opt-in, Stripe mode test, and the pinned unexpired bold-reindeer-495 backend. Check all configured gateway targets and the effective destination: public-convex-gateway chooses CONVEX_SITE_URL before CONVEX_URL before NEXT_PUBLIC_CONVEX_URL. Fail closed on conflicting overrides; do not approve one URL but forward to another. Only the pinned cloud/site pair may be present in those target slots.

Allow one configured strict bare HTTPS origin under Junyen's vercel.app Preview hostname, matched exactly to https:// plus the system VERCEL_BRANCH_URL. Use that stable branch origin so an immutable VERCEL_URL changing on redeployment does not cause a configuration loop. Do not guess an actual deployed hostname; tests may use a clearly labeled fixture. Reject custom/production/localhost origins and all alternate aliases, including the unique deployment URL. For all three sandbox purchase POSTs require an exact canonical Origin header equal to the approved configured origin AND request URL origin; reject missing/null Origin, malformed values, credentials, paths, queries, fragments, noncanonical spelling, explicit ports, lists and forwarded-header substitutions before forwarding. Never infer sandbox deployment identity from a request header. SSR uses only the server predicates, with one test notice.

Backend must independently require opt-in, immutable system CONVEX_CLOUD_URL exactly bold-reindeer-495, the same reviewed conservative unexpired cutoff, SKYLA_STRIPE_MODE=test, a sk_test_ secret key (no live/restricted key), and exactly one strict Junyen Preview return/public origin that matches both configured public origin and return-origin setting. Reject grand-ferret-807 and original Dev/Prod even if flags/key/origin are otherwise valid. Preserve gateway bearer authorization, request-size limits, parsing, rate limits, capacity, trusted pricing, payment idempotency, webhook verification/mode checking, and fulfillment. No unauthenticated mutation or staff authorization changes.

Keep siteConfig.launched=false and existing production gate semantics. Existing local visual-only preview must stay visual-only. Do not add fake payments, bypass payment confirmation, auto-issue tickets, or weaken assertions.

In the verified Preview context, SSR must render the existing checkout and one plain notice such as “Test checkout. No real money is charged.” using existing typography/layout. Do not call it a real paid admission. The normal production prelaunch view and full-venue links stay intact. Do not globally replace status banners on unrelated pages. Preserve accessible labels, focus targets, no-JS readability, reduced motion, and 320px width support.

Tests must prove missing/partial flags, Vercel production, local development, wrong backend, original Dev/Prod, live key/mode, malformed or mismatched origin remain closed. Valid verified context opens both web and backend gates; existing authorization/rate limits remain effective. Production route tests remain meaningful, not deleted. Render SSR sandbox notice and existing production copy in tests. No actual provider calls in tests.

## Design contract

Audience: visitors outside/lobby, primarily phones, who need quick admission and accurate payment status. Emotional job: confidence in date, people, price, and whether money moved. Proof order and density: existing single checkout heading, pricing/party/date form, review, payment, confirmation. Existing linear document; normal anchor navigation to full venue; native scrolling; explicit forms; no new motion. Mobile retains the same order without overlays.

Hypothesis: one readable test notice in the existing checkout lets staff verify the actual payment journey without mistaking a sandbox confirmation for paid public admission, while retaining the already tested controls.

Three directions evaluated for this narrow increment: (1) plain in-flow notice before the existing checkout, selected because it is immediately legible with zero layout change; (2) separate test-mode landing screen, rejected because it adds a step unrelated to admission; (3) persistent overlay/watermark, rejected because it obstructs mobile controls and ticket QR. The selected amendment is hybrid, reusing this customer's accepted mechanics. Templates, cinematic motion, portfolio anatomy, component libraries, and media generation have no job here. The unchanged structural fingerprint is this customer's existing checkout, not an imported portfolio design; do not redesign it to force artificial divergence.

## Scope

Authorized: apps/web/app/checkout/page.tsx; apps/web/app/api/ticket-sales-gate.ts; the three existing API handlers that call it; apps/web/lib/sandbox-admission.ts (new); relevant existing launch-gate/pricing tests plus new sandbox gate tests; convex/http.ts and convex/lib/sandboxAdmission.ts (new) plus focused gateway tests; shared pure sandbox predicate and reviewed singleton binding under packages/config/src if useful, with export only (no existing site config change); .agent-spec/sandbox-gate/README.md and design decisions/report.

Protected: every other runtime path, global CSS/design system, homepage, full-venue inquiry path, staff/Clerk/payment fulfillment/schema/cron logic, dependencies/lockfile, .env files, original repositories/worktrees, research artifacts outside this repo, AGENTS.md and hub instructions. No provider operations, browsers, commits, pushes, deployments, new credentials, or process-pattern kills.
