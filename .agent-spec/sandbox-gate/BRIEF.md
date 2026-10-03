# SkyDeck admission sandbox gate

The owner approved implementation and froze delivery to QR → Stripe test payment → phone ticket → staff admission. This phase only allows that test in one isolated backend and a Vercel Preview. Preserve the accepted checkout design. No dashboard polish, homepage work, private-event redesign, production activation, or new dependencies.

## Ground truth

- Adults 18+ $20; ages 8–17 $10; ages 0–7 free. All ages count toward 30 physically inside. Selected Los Angeles day/entry time, same-day validity, no re-entry.
- Individual tickets are allowed. `siteConfig.launched=false` describes current online transaction activation, not whether the venue or normal visits operate.
- Existing checkout and backend public gateway both block purchases while that flag is false. Local preview renders controls but cannot purchase. The original production must remain blocked by that flag during this phase.
- Existing production source: junyengit/skyla at 753d02f. Vercel Junyen Enterprises project web, root apps/web. No provider environment variables, shared variables, or integrations are currently linked there.
- Fresh isolated Convex Preview created 2026-10-03: https://grand-ferret-807.convex.cloud / https://grand-ferret-807.convex.site. Actual reference jacobantonioboss:skyla:preview/preview-skydeck-admission-20261003; four-day expiry. Never modify original Development disciplined-chickadee-688 or Production perceptive-fox-396.
- Core branch excludes parked Billing work and is based on 5a4b5c9. Baseline is now deterministic and passes 1,477 tests.

## Acceptance contract

Add a narrow opt-in. Exact names are your implementation choice; document them in README.md. Web must require VERCEL_ENV=preview, explicit opt-in, Stripe mode test, the exact isolated Convex URL grand-ferret-807, and a single strict bare HTTPS origin hosted under Junyen's vercel.app Preview hostname. Do not accept production/custom-domain/localhost origins. Gate purchase requests against that configured origin as well as the server context; reject mismatches rather than trusting arbitrary forwarded headers.

Backend must independently require opt-in, its immutable system CONVEX_CLOUD_URL exactly grand-ferret-807, SKYLA_STRIPE_MODE=test, a sk_test_ secret key (no live/restricted key), and one exact strict Junyen Preview return/public origin. Preserve normal gateway bearer authorization, request-size limits, parsing, rate limits, capacity, trusted pricing, payment idempotency, webhook verification/mode checking, and fulfillment. No unauthenticated mutation or staff authorization changes. Requests routed directly to original Dev/Prod must stay blocked regardless of sandbox flags.

Keep siteConfig.launched=false and existing production gate semantics. Existing local visual-only preview must stay visual-only. Do not add fake payments, bypass payment confirmation, auto-issue tickets, or weaken assertions.

In the verified Preview context, SSR must render the existing checkout and one plain notice such as “Test checkout. No real money is charged.” using existing typography/layout. Do not call it a real paid admission. The normal production prelaunch view and full-venue links stay intact. Do not globally replace status banners on unrelated pages. Preserve accessible labels, focus targets, no-JS readability, reduced motion, and 320px width support.

Tests must prove missing/partial flags, Vercel production, local development, wrong backend, original Dev/Prod, live key/mode, malformed or mismatched origin remain closed. Valid verified context opens both web and backend gates; existing authorization/rate limits remain effective. Production route tests remain meaningful, not deleted. Render SSR sandbox notice and existing production copy in tests. No actual provider calls in tests.

## Design contract

Audience: visitors outside/lobby, primarily phones, who need quick admission and accurate payment status. Emotional job: confidence in date, people, price, and whether money moved. Proof order and density: existing single checkout heading, pricing/party/date form, review, payment, confirmation. Existing linear document; normal anchor navigation to full venue; native scrolling; explicit forms; no new motion. Mobile retains the same order without overlays.

Hypothesis: one readable test notice in the existing checkout lets staff verify the actual payment journey without mistaking a sandbox confirmation for paid public admission, while retaining the already tested controls.

Three directions evaluated for this narrow increment: (1) plain in-flow notice before the existing checkout, selected because it is immediately legible with zero layout change; (2) separate test-mode landing screen, rejected because it adds a step unrelated to admission; (3) persistent overlay/watermark, rejected because it obstructs mobile controls and ticket QR. The selected amendment is hybrid, reusing this customer's accepted mechanics. Templates, cinematic motion, portfolio anatomy, component libraries, and media generation have no job here. The unchanged structural fingerprint is this customer's existing checkout, not an imported portfolio design; do not redesign it to force artificial divergence.

## Scope

Authorized: apps/web/app/checkout/page.tsx; apps/web/app/api/ticket-sales-gate.ts; the three existing API handlers that call it; apps/web/lib/sandbox-admission.ts (new); relevant existing launch-gate/pricing tests plus new sandbox gate tests; convex/http.ts and convex/lib/sandboxAdmission.ts (new) plus focused gateway tests; shared pure sandbox predicate under packages/config/src if useful, with export only (no existing config change); .agent-spec/sandbox-gate/README.md and design decisions/report.

Protected: every other runtime path, global CSS/design system, homepage, full-venue inquiry path, staff/Clerk/payment fulfillment/schema/cron logic, dependencies/lockfile, .env files, original repositories/worktrees, research artifacts outside this repo, AGENTS.md and hub instructions. No provider operations, browsers, commits, pushes, deployments, new credentials, or process-pattern kills.
