# Vercel Deployment Runbook

## Project Shape

- Monorepo root: repository root
- Vercel project root directory: `apps/web`
- Framework preset: Next.js
- Install command: `cd ../.. && pnpm install --frozen-lockfile`
- Build command: `cd ../.. && pnpm turbo build --filter=@skyla/web`
- Output directory: leave as the Vercel Next.js default
- Package manager: `pnpm@11.9.0`
- Node.js version: `24.x`
- Production branch: `main`

These commands assume Vercel executes from the configured `apps/web` project root. If the Vercel project is configured from the repository root instead, omit `cd ../..`. Vercel can also infer Turborepo builds, but the explicit filtered build keeps the first deployment narrow.

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

Do not point `skydeckla.com` to Vercel until:

- The Vercel production deployment is green.
- The homepage, ticket path, legal pages, admin gate, and POS gate load.
- Payment/order flows have been verified or intentionally disabled behind a safe placeholder.
- Rollback path is documented.

Keep GitHub Pages live until Vercel production is verified. Disable GitHub Pages only after explicit confirmation.
