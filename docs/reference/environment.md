# Environment Reference

This matrix lists the current environment variables needed during the Skyla
Vercel, Convex, and payment migration. It is intentionally plain: public means
safe for browser code, secret means dashboard/server only.

## Human Summary

- Vercel owns the web app environment.
- Convex owns database functions and payment actions.
- Stripe keys stay server-side except the publishable key.
- The live site can keep running without Convex envs, but writes and payments
  intentionally fail closed until Convex and Stripe envs are both configured.
- Supabase variables are legacy-only during this cutover. Do not add them back
  for new Next.js App Router flows.
- Legacy data migration uses a short-lived Convex token and direct HTTPS client
  URL. Remove the token after every development or production migration window.

## Matrix

| Variable | Public? | Set In | Scope | Why It Exists | Current Gate |
| --- | --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | yes | Vercel | Production/Preview/Development | Browser-safe canonical URL. | Helpful for UI links and return URLs. |
| `NEXT_PUBLIC_CONVEX_URL` | yes | Vercel | Production/Preview/Development | Lets Next routes call the linked Convex deployment. | Required for persisted checkout drafts from Vercel. |
| `CONVEX_DEPLOYMENT` | no | local + Convex CLI | local/dev | Links local codegen to the real Convex project. | Must not be `anonymous:*` for cloud readiness. |
| `CONVEX_URL` | no | operator shell / local tooling | Development or migration session | Server-side Convex URL for local checks and the direct HTTPS legacy migration client. | Migration commands require this or `--convex-url`; cloud URLs must be HTTPS on `convex.cloud`, localhost is allowed only for local development, and every remote apply/rollback requires explicit confirmation because the URL does not identify its environment. |
| `SKYLA_STRIPE_MODE` | no | Convex | Production/Preview/Development | Required Stripe mode guard. Use `test` for preview/test acceptance and `live` only after live cutover is approved. | Required before any Stripe Checkout, Terminal, or webhook action can run. |
| `STRIPE_SECRET_KEY` | no | Convex | Production/Preview/Development | Allows Convex actions to create Stripe Checkout Sessions and Stripe Terminal PaymentIntents. Must match `SKYLA_STRIPE_MODE` (`sk_test_` for `test`, `sk_live_` for `live`). | Required before `payments.createStripeCheckoutSession` or `payments.createStripeTerminalPaymentIntent` can run. |
| `SKYLA_PAYMENT_RETURN_ORIGINS` | no | Convex | Production/Preview/Development | Comma-separated allowed origins for Stripe success/cancel URLs. | Required; example `https://skydeckla.com,https://www.skydeckla.com`. |
| `STRIPE_WEBHOOK_SECRET` | no | Convex | Production/Preview/Development | Verifies Stripe webhook signatures for Checkout order reconciliation and Terminal POS sale reconciliation at `POST /stripe-webhook`. | Required before webhook cutover. |
| `SKYLA_TERMINAL_READER_REGISTRY` | no | Convex | Production/Preview/Development | Comma-separated trusted Stripe Terminal readers, optionally paired to locations as `tmr_reader@tml_location`. | Required before native `/pos` can persist a reader or process a reader handoff. |
| `SKYLA_POS_TERMINAL_ACCEPTANCE` | no | Convex + Vercel/local runtime | Production/Preview/Development | Explicit latch for card-present reader handoff. Set to `enabled` only after Stripe test-reader acceptance passes. | Required before native `/pos` can create/process Terminal reader payments. |
| `SKYLA_STAFF_BOOTSTRAP_TOKEN` | no | Convex | Temporary setup only | Authorizes the typed `staffBootstrap.upsertStaffUser` seed mutation before any staff rows exist. | Set only while seeding staff, then remove or rotate. |
| `SKYLA_DATA_MIGRATION_TOKEN` | no | Convex + operator shell | Temporary migration only | Authorizes legacy batch apply, read-only summary, and per-batch rollback for bookings, members, and inquiries. Must be 32+ characters with no whitespace. | Generate randomly, set interactively in the selected Convex deployment, and remove immediately after reconciliation or rollback. Never set in Vercel. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | yes | Vercel | Production/Preview/Development | Browser-safe Stripe.js publishable key. | Needed only when frontend is wired to Stripe.js or embedded Checkout. |
| `KASKADE_API_KEY` | no | Convex | Production/Preview/Development | Future Kaskade payment action secret. | Not ready; legacy bridge still exists. |
| `SKYLA_TERMINAL_SETUP_TOKEN` | no | retired legacy only | none | Former one-time manager token for the Supabase Terminal reader setup bridge. | Do not set for new work. The repo copy of the legacy Terminal function now returns `410` for `setup-reader`; future reader setup should be rebuilt as a native staff/Convex workflow. |
| `SUPABASE_URL` | mixed | Vercel/Supabase legacy | Transition only | Legacy deployed dashboard/data migration only. App Router public, admin, checkout, and POS flows should not depend on it. | Do not reintroduce for new Next routes; remove after Convex replacements are accepted. |
| `SUPABASE_ANON_KEY` | yes-ish | Vercel/Supabase legacy | Transition only | Legacy deployed dashboard/data migration only. | Do not add to new browser paths and never pair it with service-role powers. |
| `SUPABASE_SERVICE_ROLE_KEY` | no | server only | Transition only | Legacy server migration/admin tasks. | Never expose to `NEXT_PUBLIC_*`; avoid Preview production access. |
| `NEXT_PUBLIC_GOOGLE_ADS_TAG_ID` | yes | Vercel | Production/Preview | Google Ads tag for native conversion pages and remaining compatibility pages. | Optional; blank keeps tracking inert. |
| `NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_CONVERSION` | yes | Vercel | Production/Preview | Purchase conversion label. | Optional until paid ads are active. |

## Local Acceptance Harness Variables

These are shell-only flags for `bun run test:acceptance:linked`. Do not set
them as permanent Vercel or Convex runtime variables.

| Variable | Required? | Example | Purpose |
| --- | --- | --- | --- |
| `ACCEPTANCE_BASE_URL` | yes | `https://web-git-<branch>-junyen-enterprises.vercel.app` | Vercel Preview branch alias under test. Direct deployment URLs and production aliases are refused by default. |
| `SKYLA_ACCEPTANCE_MODE` | yes | `linked-test` | Explicitly opts into linked Preview writes. |
| `SKYLA_ACCEPTANCE_STRIPE_MODE` | yes | `test` | Refuses acceptance unless the operator confirms Stripe test mode. |
| `SKYLA_ACCEPTANCE_NO_REAL_CARDS` | yes | `1` | Confirms no real cards should be used. |
| `SKYLA_STAFF_TEST_TOKEN` | yes | `<seeded staff token>` | Staff bearer token for reader and POS draft checks. |
| `SKYLA_ACCEPTANCE_STRIPE_CHECKOUT` | no | `1` | Also create a Stripe test-mode Checkout Session from the stored `orderRef`; requires the remote readiness snapshot to report Stripe Checkout ready in test mode. |
| `SKYLA_ACCEPTANCE_TERMINAL_READER` | no | `1` | Also ask a Stripe test Terminal reader to process the stored sale; requires the remote readiness snapshot to report Terminal reader processing ready in test mode. |
| `SKYLA_ALLOW_PRODUCTION_ACCEPTANCE` | no | `1` | Allows the harness to run against `skydeckla.com`; leave unset for Preview-first acceptance. |

## Stripe Return Origins

`SKYLA_PAYMENT_RETURN_ORIGINS` must contain origins only, not full paths:

```text
https://skydeckla.com,https://www.skydeckla.com,https://web-<preview>.vercel.app
```

Good:

- `https://skydeckla.com`
- `https://www.skydeckla.com`
- `http://localhost:3000`

Bad:

- `https://skydeckla.com/checkout`
- `http://skydeckla.com`
- `https://example.com`

## Stripe Mode

`SKYLA_STRIPE_MODE` is a safety latch, not just documentation. Convex payment
actions reject a Stripe secret key whose prefix does not match the mode, and
the Convex Stripe webhook rejects events whose `livemode` flag does not match.
Use `test` until preview checkout and POS Terminal acceptance pass.

## Terminal Reader Registry

`SKYLA_TERMINAL_READER_REGISTRY` is a Convex-only allowlist. The native POS
screen loads this list through the staff-gated `/api/pos/readers` route, then
sends only the selected `readerId` when a sale draft is reviewed. Convex stores
the reader only when it is in this registry.

```text
tmr_frontdesk@tml_lobby,tmr_bar@tml_rooftop
```

Good:

- `tmr_frontdesk@tml_lobby`
- `tmr_frontdesk`

Use the paired `reader@location` form when possible. If a location is paired in
the registry, Convex derives that location from the allowlist. Browser-sent
Terminal locations are ignored by the Next POS draft route and must not be used
as payment authority. If no registry is set, reader listing and reader
persistence fail closed. Duplicate `readerId` entries also fail closed.

## Raw Agent Checks

```bash
PATH="$HOME/.bun/bin:$PATH" bun run convex:env:check
PATH="$HOME/.bun/bin:$PATH" bun run vercel:project:check
PATH="$HOME/.bun/bin:$PATH" bun run vercel:env:check
PATH="$HOME/.bun/bin:$PATH" bun run dashboard:readiness
PATH="$HOME/.bun/bin:$PATH" bun --revision
```

`vercel:project:check` verifies the non-secret Vercel project shape: project
ID/name, root directory `apps/web`, Next.js framework, Node `24.x`, optional
local `.vercel` link, and the committed `apps/web/vercel.json` Bun canary
install/build commands. Vercel's dashboard project settings may still display
default install/build command text; the committed `vercel.json` overrides those
values for deployments and is the source of truth for Skyla's Bun canary path.

`vercel:env:check` reads `vercel env ls --format json` from the linked
`apps/web` project and reports only names/scopes. It fails until
`NEXT_PUBLIC_CONVEX_URL` exists in Preview and Production, and it also fails if
Stripe, staff, or Terminal secrets are accidentally placed in the Vercel
project instead of Convex. Do not print secret values in logs, PRs, or docs.
Check presence, scope, and shape only.

`dashboard:readiness` combines the safe Vercel project, Vercel env, and Convex
env checks into one JSON report. It exits non-zero until the linked Preview
no-write preflight has the minimum dashboard shape: Vercel project shape is
aligned, Vercel has `NEXT_PUBLIC_CONVEX_URL` in Preview and Production, Vercel
has no misplaced payment/staff secrets, Convex is cloud linked, Stripe Checkout
envs are present, and Stripe webhook envs are present. The report includes
ordered `nextActions` for the dashboards and always keeps
`safeToUseRealCards: false` during migration verification.

## Staff Bootstrap Token

Use `SKYLA_STAFF_BOOTSTRAP_TOKEN` only to create or update initial
`staffUsers` rows after the real Convex project is linked. It must be at least
32 characters and contain no whitespace.

After staff is seeded and a real staff bearer token can load `/admin`, remove
the bootstrap token from Convex:

```bash
PATH="$HOME/.bun/bin:$PATH" bunx convex env remove SKYLA_STAFF_BOOTSTRAP_TOKEN
```
