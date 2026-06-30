# Vercel Deployment Runbook

## Project Shape

- Monorepo root: repository root
- Vercel project root directory: `apps/web`
- Vercel team: `Junyen Enterprises` (`team_3kWPO8fPD6E7x39voGoNNeog`)
- Vercel project: `web` (`prj_fhlOjcwSbnPAuLi8tTiGbhjVomnr`)
- Framework preset: Next.js
- Install command: `cd ../.. && pnpm install --frozen-lockfile`
- Build command: `cd ../.. && pnpm turbo build --filter=@skyla/web`
- Output directory: leave as the Vercel Next.js default
- Package manager: `pnpm@11.9.0`
- Node.js version: `24.x`
- Production branch: `main`

These commands assume Vercel executes from the configured `apps/web` project root. If the Vercel project is configured from the repository root instead, omit `cd ../..`. Vercel can also infer Turborepo builds, but the explicit filtered build keeps the first deployment narrow.

## Current Production State

As of June 30, 2026:

- The most recently verified application production deployment from `main` is READY at `https://web-gq0o1xfqu-junyen-enterprises.vercel.app`.
- Production deployment ID is `dpl_CUxoYMKy2kxzq3j5kY1M1TNn38um`.
- Latest verified application commit is `7bfe12a6e3263bab1357b1fd28946873e29642e1`.
- `skydeckla.com` and `www.skydeckla.com` are attached to the Vercel project and Vercel reports both as configured correctly.
- Vercel production route compatibility is verified on the deployment URL, apex domain, and `www` domain.
- GoDaddy nameservers have been changed to Vercel nameservers. Custom-domain smoke tests pass without DNS overrides.
- Vercel Authentication is disabled for production; the deployment URL is publicly reachable.

## Temporary Legacy Bridge

During cutover, `apps/web` includes static compatibility files in `apps/web/public` for existing public routes. `next.config.mjs` rewrites extensionless URLs such as `/checkout` and `/members` to their `.html` compatibility files.

Keep the bridge until the equivalent App Router routes are rebuilt with server-authoritative payments, Convex data access, and authenticated admin/POS flows.

## Setup Flow

1. Link or create one Vercel project for `@skyla/web`.
2. Set the root directory to `apps/web`.
3. Use the Next.js framework preset.
4. Add environment variables in separate Production, Preview, and Development scopes.
5. Deploy a preview from the migration branch.
6. Run smoke tests.
7. Merge to `main` only after CI and preview pass.
8. Let Vercel deploy production from `main`.

## Environment Buckets

Public client variables may use the `NEXT_PUBLIC_` prefix. Secrets must never use that prefix.

- Public client config: `NEXT_PUBLIC_SITE_URL`, analytics IDs, Meta Pixel IDs, and public Stripe publishable keys.
- Server secrets: Stripe secret keys, webhook signing secrets, Kaskade secrets, email provider secrets, and future Convex deployment/admin secrets.
- Transition-only backend variables: Supabase URL, anon key, and service-role key only while legacy flows remain. Do not give Preview production service-role access.
- Feature flags: payments enabled, crypto enabled, admin/POS enabled, and migration/legacy mode.
- Operations config: booking recipient emails, sender domains, terminal location IDs, and webhook URLs.

## Git Workflow

1. Open a PR from the migration branch.
2. Vercel creates a Preview deployment from the branch.
3. GitHub CI runs `pnpm install --frozen-lockfile`, lint, typecheck, unit tests, build, tracked artifact guard, and dependency audit.
4. Run smoke tests against the Preview deployment.
5. Merge to `main`.
6. Vercel deploys Production from `main`.

## Domain Cutover

`skydeckla.com` and `www.skydeckla.com` are currently cut over to Vercel DNS. Before making future domain or deployment changes, confirm:

- The Vercel production deployment is green.
- The homepage, ticket path, member path, legal pages, admin gate, POS gate, robots, and sitemap load.
- Payment/order flows have been verified or intentionally disabled behind a safe placeholder.
- Rollback path is documented.
- Vercel DNS nameservers are active, Vercel domain verification passes for both domains, and custom-domain smoke tests pass without DNS overrides.

Keep GitHub Pages live as rollback until backend/payment/admin/POS migration and explicit rollback retirement are complete. Disable GitHub Pages only after explicit confirmation.
