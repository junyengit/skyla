# Vercel Deployment Runbook

## Project Shape

- Monorepo root: repository root
- Vercel project root directory: `apps/web`
- Vercel team: `Junyen Enterprises` (`team_3kWPO8fPD6E7x39voGoNNeog`)
- Vercel project: `web` (`prj_fhlOjcwSbnPAuLi8tTiGbhjVomnr`)
- Framework preset: Next.js
- Install command: `cd ../.. && bash scripts/setup/vercel-install-bun-canary.sh`
- Build command: `cd ../.. && export PATH="$HOME/.bun/bin:$PATH" && bun --revision && bun run web:build`
- Output directory: leave as the Vercel Next.js default
- Package manager: Bun canary with committed text `bun.lock`
- Vercel Bun runtime: `bunVersion: "1.x"` in `apps/web/vercel.json`
- Node.js version: `24.x`
- Production branch: `main`

These commands assume Vercel executes from the configured `apps/web` project
root. If the Vercel project is configured from the repository root instead,
omit `cd ../..`. The install script downloads the reviewed Bun archive as data,
verifies its committed SHA-256 and exact Linux x64 revision, and runs a frozen
install from the repository root. It does not execute an upstream shell
installer or self-upgrade. `bunVersion: "1.x"` is the separately managed Vercel
Functions runtime setting, not the build-time package-manager pin.

Vercel's dashboard project settings may show default install/build command
labels. For Skyla, the committed `apps/web/vercel.json` is the build authority:
it overrides the framework, install command, build command, and Bun runtime for
deployments. Run `bun run vercel:project:check` before dashboard work to verify
the dashboard root/Node/framework shape, repo-owned commands, exact Linux x64
Bun revision/SHA-256, and immutable installer behavior.

## Current Production State

As of July 13, 2026:

- The single current commit -> deployment -> immutable URL chain is recorded in
  [Current Deployment Identity](../current-state-simple.md#current-deployment-identity).
- PR #125 remains the latest full production route/payment behavior evidence.
  Keep that evidence separate from newer deployment identity created by
  docs-only or tooling merges.
- Query Vercel before replacing the centralized identity; do not copy the exact
  current URL and deployment ID into multiple runbooks.
- `skydeckla.com` and `www.skydeckla.com` are attached to the Vercel project and Vercel reports both as configured correctly.
- Vercel production route compatibility is verified on the behavior-evidence
  deployment URL, apex domain, and `www` domain with the registry-derived smoke
  matrix. Its count comes from the script and route registry, not this runbook.
- GoDaddy nameservers have been changed to Vercel nameservers. Custom-domain smoke tests pass without DNS overrides.
- Vercel Authentication is disabled for production; the deployment URL is publicly reachable.
- Public write and payment routes fail closed until the real Convex deployment
  URL and matching `SKYLA_PUBLIC_GATEWAY_SECRET` are configured in Vercel and
  Convex; Stripe actions also require their Convex-only dashboard secrets.
- The recorded deployment metadata reports target `production`, framework
  `nextjs`, Node `24.x`, Bun runtime metadata, and Turbopack bundler metadata.
- Vercel env vars are still absent, so Convex-backed writes and Stripe
  execution remain intentionally fail-closed until dashboard setup is complete.

## Bun Deployment Changes

- `apps/web/vercel.json` commits the Bun/Vercel install and build commands.
- Root GitHub Pages static files are removed from the active tree.
- GitHub Pages was disabled on July 2, 2026.
- Hosting rollback should use Vercel deployment rollback, not root static or
  GitHub Pages rollback.

## Saved-Link Compatibility

App Router owns all public and staff extensionless routes. The old `.html`
paths are permanent redirects generated from `apps/web/site-routes.mjs`; no
static compatibility documents are deployed from `apps/web/public`.

Keep the redirect registry while saved bookmarks, ads, and historical links
still use those paths. Verify it with the route and production-readiness smokes
after every routing change.

## Setup Flow

1. Link or create one Vercel project for `@skyla/web`.
2. Set the root directory to `apps/web`.
3. Use the Next.js framework preset.
4. Add environment variables in separate Production, Preview, and Development scopes.
5. Deploy a preview from the migration branch.
6. Run smoke tests.
7. Merge to `main` only after CI and preview pass.
8. Let Vercel deploy production from `main`.

## Environment

Public client variables may use the `NEXT_PUBLIC_` prefix. Secrets must never use that prefix.

Use [../reference/environment.md](../reference/environment.md) as the detailed
matrix for public variables, server secrets, transition variables, owner
systems, and readiness gates.

For Convex-specific dashboard setup and verification, use
[convex-deployment.md](convex-deployment.md).

For Stripe Checkout cutover, use
[stripe-checkout-cutover.md](stripe-checkout-cutover.md).

Google Ads public env vars used by the compatibility bridge:

```bash
NEXT_PUBLIC_GOOGLE_ADS_TAG_ID=AW-XXXXXXXXX
NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_CONVERSION=AW-XXXXXXXXX/label
NEXT_PUBLIC_GOOGLE_ADS_EVENT_LEAD_CONVERSION=AW-XXXXXXXXX/label
NEXT_PUBLIC_GOOGLE_ADS_MEMBERSHIP_LEAD_CONVERSION=AW-XXXXXXXXX/label
NEXT_PUBLIC_GOOGLE_ADS_BEGIN_CHECKOUT_CONVERSION=AW-XXXXXXXXX/label
```

Leave any conversion env var blank to keep that event disabled. Do not hard-code Google Ads IDs in public static files.

After adding Vercel env vars, run the safe presence/scope checker from the repo
root:

```bash
PATH="$HOME/.bun/bin:$PATH" bun run vercel:project:check
PATH="$HOME/.bun/bin:$PATH" bun run vercel:env:check
```

If the local checkout is not linked, link the Vercel project from the Vercel
project root first:

```bash
cd apps/web
PATH="$HOME/.bun/bin:$PATH" bunx vercel link --yes --scope junyen-enterprises --project web
cd ../..
```

It uses `vercel env ls --format json` for the linked `apps/web` project. It
requires a Preview-only `NEXT_PUBLIC_CONVEX_URL` binding for the Convex
development deployment and a separate Production-only binding for Convex
production. It also requires separate Preview-only and Production-only
`SKYLA_PUBLIC_GATEWAY_SECRET` bindings; each value must match only its
corresponding Convex deployment. It fails if Stripe keys, webhook secrets,
staff-bootstrap tokens, or the Terminal reader registry are present in Vercel. The temporary
`SKYLA_POS_TERMINAL_ACCEPTANCE` latch is allowed only in one explicitly selected
acceptance target:

```bash
SKYLA_VERCEL_TERMINAL_ACCEPTANCE_TARGET=preview bun run vercel:env:check
```

Remove that latch from Vercel and the matching Convex deployment after the
controlled reader attempt. The checker reports names and scopes only; do not
print secret values in PRs, logs, or docs.

## Git Workflow

1. Open a PR from the migration branch.
2. Vercel creates a Preview deployment from the branch.
3. GitHub CI runs `bun install --frozen-lockfile`, lint, typecheck, unit tests, build, tracked artifact guard, and dependency audit.
4. Run smoke tests against the Preview deployment.
5. Run `bun run test:payments` against the Preview deployment when the change
   touches checkout, POS, Stripe, retired Kaskade/Supabase stubs, or Convex
   payment code. Kaskade is not an active provider implementation.
6. Confirm the protected-branch checks are green: `ci-build`,
   `Analyze JavaScript and TypeScript`, and `Vercel`.
7. Merge to `main`.
8. Vercel deploys Production from `main`.

## Domain Cutover

`skydeckla.com` and `www.skydeckla.com` are currently cut over to Vercel DNS. Before making future domain or deployment changes, confirm:

- The Vercel production deployment is green.
- The homepage, ticket path, member path, legal pages, admin gate, POS gate, robots, and sitemap load.
- Payment/order flows have been verified or intentionally disabled behind a safe placeholder.
- `bun run test:payments` passes on the production deployment URL, apex domain,
  and `www` domain.
- Rollback path is documented.
- Vercel DNS nameservers are active, Vercel domain verification passes for both domains, and custom-domain smoke tests pass without DNS overrides.

Use previous Vercel deployments as the hosting rollback path. Do not disable
legacy Supabase functions/storage or payment webhooks until the Convex/payment
replacement is verified and explicitly accepted.
