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

- Production deployment from `main` is READY at `https://web-istczvmf1-junyen-enterprises.vercel.app`.
- Production deployment ID is `dpl_FBG27TbZxzTzfQKgTy4LWaxKF35L`.
- Latest merged production commit is `f3c99649ea87a9b94e40bdc3e7de35f1ea98e923`.
- `skydeckla.com` and `www.skydeckla.com` are attached to the Vercel project.
- Vercel production route compatibility is verified on the deployment URL.
- GoDaddy DNS is not yet valid for Vercel. Current checks show apex `skydeckla.com` is not resolving from this environment and `www.skydeckla.com` still points through GitHub Pages.
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
3. GitHub CI runs `pnpm install --frozen-lockfile`, lint, typecheck, and build.
4. Run smoke tests against the Preview deployment.
5. Merge to `main`.
6. Vercel deploys Production from `main`.

## Domain Cutover

Do not consider `skydeckla.com` cut over to Vercel until:

- The Vercel production deployment is green.
- The homepage, ticket path, member path, legal pages, admin gate, POS gate, robots, and sitemap load.
- Payment/order flows have been verified or intentionally disabled behind a safe placeholder.
- Rollback path is documented.
- GoDaddy DNS has the Vercel apex A records and `www` CNAME, and Vercel domain verification passes for both domains.

Keep GitHub Pages live until Vercel production is verified. Disable GitHub Pages only after explicit confirmation.
