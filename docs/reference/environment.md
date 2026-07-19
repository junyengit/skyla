# Environment Reference

This matrix lists the current environment variables needed during the Skyla
Vercel, Convex, and payment migration. It is intentionally plain: public means
safe for browser code, secret means dashboard/server only.

## Human Summary

- Vercel owns the web app environment.
- Convex owns database functions and payment actions.
- Clerk authenticates human staff; Convex `staffUsers` records and
  `requireStaffUser` still authorize their Skyla roles.
- Stripe keys stay server-side except the publishable key.
- The live site can keep running without Convex envs, but writes and payments
  intentionally fail closed until Convex and Stripe envs are both configured.
- The staff UI also fails closed until the Clerk keys exist in Vercel and the
  matching Clerk issuer exists in Convex. It does not fall back to pasted staff
  tokens.
- Supabase variables are legacy-only during this cutover. Do not add them back
  for new Next.js App Router flows.
- Vercel Preview points to the Convex development deployment; Vercel Production
  points to the separate Convex production deployment. Never share one URL
  binding across both targets.
- Legacy data migration uses a short-lived Convex token and direct HTTPS client
  URL. Remove the token after every development or production migration window.

## Matrix

| Variable | Public? | Set In | Scope | Why It Exists | Current Gate |
| --- | --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | yes | Vercel | Production/Preview/Development | Browser-safe canonical URL. | Helpful for UI links and return URLs. |
| `NEXT_PUBLIC_CONVEX_URL` | yes | Vercel | Preview only | Lets Preview Next routes call the Convex development deployment. | Required as a Preview-only binding before linked Preview writes. Do not reuse the Production value. |
| `NEXT_PUBLIC_CONVEX_URL` | yes | Vercel | Production only | Lets Production Next routes call the Convex production deployment. | Required as a separate Production-only binding. Do not reuse the development value. |
| `SKYLA_PUBLIC_GATEWAY_SECRET` | no | matching Vercel target + Convex deployment | Preview/Production | Authenticates the only HTTP path allowed to invoke public inquiry, membership, checkout-draft, and Stripe Checkout writes; it also HMACs Vercel's trusted client address into a non-reversible rate-limit key. | Generate separate random 32+ character values for Preview and Production. Set each only in the matching Vercel target and Convex deployment. Never expose it through `NEXT_PUBLIC_*`, logs, or support output. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | yes | Vercel | Preview/Production | Initializes route-scoped Clerk v7 on the staff sign-in, Admin, and POS routes. | Required in both scopes before staff sign-in acceptance. Missing configuration shows setup-required and keeps staff workflows closed. |
| `CLERK_SECRET_KEY` | no | Vercel | Preview/Production | Lets the Next.js Clerk integration validate and manage the server-side staff session. | Required in both scopes. Never expose it through `NEXT_PUBLIC_*` or place it in Convex. |
| `CONVEX_DEPLOYMENT` | no | local + Convex CLI | local/dev | Links local codegen to the real Convex project. | Must not be `anonymous:*` for cloud readiness. |
| `CONVEX_URL` | no | operator shell / local tooling | Development or migration session | Server-side Convex URL for local checks and the direct HTTPS legacy migration client. | Migration commands require this or `--convex-url`; cloud URLs must be HTTPS on `convex.cloud`, localhost is allowed only for local development, and every remote apply/rollback requires explicit confirmation because the URL does not identify its environment. |
| `CONVEX_SITE_URL` | no | local Next server only | Local development | Explicit Convex HTTP-action origin when a local deployment cannot be derived from a `convex.cloud` URL. | Optional for cloud deployments, where Next derives the paired `convex.site` origin. Local values may use `http://127.0.0.1:<port>`; never expose through `NEXT_PUBLIC_*`. |
| `CLERK_JWT_ISSUER_DOMAIN` | no | Convex | Production/Preview/Development | Identifies the trusted Clerk issuer for the `convex` JWT integration. | Required before Convex accepts Clerk-authenticated staff calls. It must match the Clerk application used by the corresponding Vercel environment. |
| `SKYLA_STRIPE_MODE` | no | Convex | Production/Preview/Development | Required Stripe mode guard. Use `test` for preview/test acceptance and `live` only after live cutover is approved. | Required before any Stripe Checkout, Terminal, or webhook action can run. |
| `STRIPE_SECRET_KEY` | no | Convex | Production/Preview/Development | Allows Convex actions to create Stripe Checkout Sessions and Stripe Terminal PaymentIntents. Must match `SKYLA_STRIPE_MODE` (`sk_test_` for `test`, `sk_live_` for `live`). | Required before `payments.createStripeCheckoutSession` or `payments.createStripeTerminalPaymentIntent` can run. |
| `SKYLA_PAYMENT_RETURN_ORIGINS` | no | Convex | Production/Preview/Development | Comma-separated allowed origins for Stripe success/cancel URLs. | Required; example `https://skydeckla.com,https://www.skydeckla.com`. |
| `STRIPE_WEBHOOK_SECRET` | no | Convex | Production/Preview/Development | Verifies Stripe webhook signatures for Checkout order reconciliation and Terminal POS sale reconciliation at `POST /stripe-webhook`. | Required before webhook cutover. |
| `RESEND_API_KEY` | no | Convex | Production/Preview/Development | Sends the confirmed ticket email after the signed paid Checkout or Terminal webhook creates fulfillment. | Required before ticket email delivery. Keep separate test and production sending domains where practical; never set in Vercel or expose through `NEXT_PUBLIC_*`. |
| `SKYLA_TICKET_FROM_EMAIL` | no | Convex | Production/Preview/Development | Verified sender used for ticket confirmation email, for example `Sky LA Tickets <tickets@skydeckla.com>`. | Required with `RESEND_API_KEY`; the sending domain must be verified before acceptance. |
| `SKYLA_TICKET_REPLY_TO` | no | Convex | Production/Preview/Development | Optional monitored reply address for ticket questions. | Defaults to `reservations@skydeckla.com`. |
| `SKYLA_PUBLIC_ORIGIN` | yes | selected Vercel runtime + matching Convex deployment | Production/Preview/Development | Canonical HTTPS origin used in ticket links and QR codes. | Required as separate Preview-only and Production-only Vercel bindings and in each matching Convex deployment. Values must be a bare HTTPS origin with no path, query, or fragment. |
| `SKYLA_TERMINAL_READER_REGISTRY` | no | Convex | Production/Preview/Development | Comma-separated trusted Stripe Terminal readers, optionally paired to locations as `tmr_reader@tml_location`. | Required before native `/pos` can persist a reader or process a reader handoff. |
| `SKYLA_POS_TERMINAL_ACCEPTANCE` | no | selected Vercel runtime + matching Convex deployment | Temporary Preview or Production acceptance window | Explicit latch checked by both the Next Terminal routes and Convex payment actions. | Set to `enabled` in both systems only after no-write preflight, webhook, and reader-registry checks pass; remove it from both immediately after the controlled test-reader window. |
| `SKYLA_STAFF_BOOTSTRAP_TOKEN` | no | Convex | Temporary setup only | Authorizes the typed `staffBootstrap.upsertStaffUser` seed mutation before any staff rows exist. | Set only while seeding staff, then remove or rotate. |
| `SKYLA_DATA_MIGRATION_TOKEN` | no | Convex + operator shell | Temporary migration only | Authorizes legacy batch apply, read-only summary, and per-batch rollback for bookings, members, and inquiries. Must be 32+ characters with no whitespace. | Generate randomly, set interactively in the selected Convex deployment, and remove immediately after reconciliation or rollback. Never set in Vercel. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | yes | Vercel | Production/Preview/Development | Browser-safe Stripe.js publishable key. | Needed only when frontend is wired to Stripe.js or embedded Checkout. |
| `KASKADE_API_KEY` | no | nowhere (retired) | none | Historical Kaskade/PharosGate integration only. | Do not set. There is no active Kaskade implementation or current architecture workstream; repo copies of the old functions are retired `410` surfaces. |
| `SKYLA_TERMINAL_SETUP_TOKEN` | no | retired legacy only | none | Former one-time manager token for the Supabase Terminal reader setup bridge. | Do not set for new work. The repo copy of the legacy Terminal function now returns `410` for `setup-reader`; future reader setup should be rebuilt as a native staff/Convex workflow. |
| `SUPABASE_URL` | mixed | Vercel/Supabase legacy | Transition only | Legacy deployed dashboard/data migration only. App Router public, admin, checkout, and POS flows should not depend on it. | Do not reintroduce for new Next routes; remove after Convex replacements are accepted. |
| `SUPABASE_ANON_KEY` | yes-ish | Vercel/Supabase legacy | Transition only | Legacy deployed dashboard/data migration only. | Do not add to new browser paths and never pair it with service-role powers. |
| `SUPABASE_SERVICE_ROLE_KEY` | no | server only | Transition only | Legacy server migration/admin tasks. | Never expose to `NEXT_PUBLIC_*`; avoid Preview production access. |
| `NEXT_PUBLIC_GOOGLE_ADS_TAG_ID` | yes | Vercel | Production/Preview | Google Ads tag for native conversion pages and remaining compatibility pages. | Optional; blank keeps tracking inert. |
| `NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_CONVERSION` | yes | Vercel | Production/Preview | Purchase conversion label. | Optional until paid ads are active. |
| `NEXT_PUBLIC_GOOGLE_ADS_EVENT_LEAD_CONVERSION` | yes | Vercel | Production/Preview | Event inquiry conversion label. | Optional until paid ads are active. |
| `NEXT_PUBLIC_GOOGLE_ADS_MEMBERSHIP_LEAD_CONVERSION` | yes | Vercel | Production/Preview | Membership lead conversion label. | Optional until paid ads are active. |
| `NEXT_PUBLIC_GOOGLE_ADS_BEGIN_CHECKOUT_CONVERSION` | yes | Vercel | Production/Preview | Checkout-start conversion label. | Optional until paid ads are active. |
| `NEXT_PUBLIC_META_PIXEL_ID` | yes | Vercel | Production/Preview | Meta Pixel ID for the conversion pages. | Optional; unset keeps the committed pixel ID, whitespace disables the pixel. Inlined at build time, so changes need a redeploy. |

## Local Acceptance Harness Variables

These are shell-only flags for `bun run test:acceptance:linked`. Do not set
them as permanent Vercel or Convex runtime variables.

| Variable | Required? | Example | Purpose |
| --- | --- | --- | --- |
| `ACCEPTANCE_BASE_URL` | yes | `https://web-git-<branch>-junyen-enterprises.vercel.app` | Vercel Preview branch alias under test. Direct deployment URLs and production aliases are refused by default. |
| `SKYLA_ACCEPTANCE_MODE` | yes | `linked-test` | Explicitly opts into linked Preview writes. |
| `SKYLA_ACCEPTANCE_STRIPE_MODE` | yes | `test` | Refuses acceptance unless the operator confirms Stripe test mode. |
| `SKYLA_ACCEPTANCE_NO_REAL_CARDS` | yes | `1` | Confirms no real cards should be used. |
| `SKYLA_STAFF_TEST_TOKEN` | yes | `<seeded staff token>` | Staff bearer token for controlled automation and reader/POS acceptance checks. The human UI does not ask staff to paste it. |
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
`apps/web` project and reports only names/scopes. It fails until the Preview-only
`NEXT_PUBLIC_CONVEX_URL` binding exists for Convex development, the separate
Production-only binding exists for Convex production, and both Clerk keys cover
Preview and Production. The checker cannot read or compare values, so the owner
must verify each Convex URL in its dashboard target before running it.

The checker fails if Stripe keys, webhook secrets, staff-bootstrap tokens, or
the Terminal reader registry are placed in Vercel. `CLERK_SECRET_KEY` is the
intentional Vercel-side server exception. `SKYLA_POS_TERMINAL_ACCEPTANCE` is a
temporary non-public latch, not a provider secret: outside acceptance it must be
absent. During a controlled window, select one target explicitly:

```bash
SKYLA_VERCEL_TERMINAL_ACCEPTANCE_TARGET=preview bun run vercel:env:check
# or, only after Preview acceptance and owner approval:
SKYLA_VERCEL_TERMINAL_ACCEPTANCE_TARGET=production bun run vercel:env:check
```

The selected Vercel target must contain the latch and the other target must not.
Set the dashboard value to `enabled`; the checker verifies name and scope, not
the value. Remove the latch from Vercel and the matching Convex deployment when
the reader attempt ends. Never print secret values in logs, PRs, or docs.

Ticket email secrets also belong in Convex. Put `RESEND_API_KEY`,
`SKYLA_TICKET_FROM_EMAIL`, and the optional `SKYLA_TICKET_REPLY_TO` there.
`SKYLA_PUBLIC_ORIGIN` is not secret, but its Vercel and Convex values must name
the same HTTPS environment so emailed links and generated QR codes agree. Add
one Preview-only Vercel binding and one Production-only binding; do not share a
single binding across both targets. `vercel:env:check` verifies that scoping but
cannot read dashboard values, so the owner must compare each value to its
matching Convex deployment.

`dashboard:readiness` combines the safe Vercel project, Vercel env, and Convex
env checks into one JSON report. It exits non-zero until the linked Preview
no-write preflight has the minimum dashboard shape: Vercel project shape is
aligned, Vercel has separate development/Preview and production/Production
Convex URL and public-origin bindings plus both Clerk keys, Vercel has no misplaced payment,
reader-registry, or staff-bootstrap secrets, Convex is
cloud linked, Convex trusts `CLERK_JWT_ISSUER_DOMAIN`, Stripe Checkout envs are
present, and Stripe webhook envs are present. The report includes ordered
`nextActions` for the dashboards and always keeps
`safeToUseRealCards: false` during migration verification.

## Staff Bootstrap Token

Use `SKYLA_STAFF_BOOTSTRAP_TOKEN` only to create or update initial
`staffUsers` rows after the real Convex project is linked. It must be at least
32 characters and contain no whitespace.

Use the Clerk user ID, not an email address or a temporary token, as the
`subject` passed to `staffBootstrap.upsertStaffUser`. After that Clerk-backed
identity can load `/admin` with the expected Convex role, remove the bootstrap
token from Convex:

```bash
PATH="$HOME/.bun/bin:$PATH" bunx convex env remove SKYLA_STAFF_BOOTSTRAP_TOKEN
```
