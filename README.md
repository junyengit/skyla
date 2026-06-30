# Skyla

Skyla is being migrated from a flat GitHub Pages static site into a Turborepo-based Next.js application on Vercel.

## Repository Layout

```text
apps/web            Next.js App Router application for Vercel
packages/config     Shared site/business constants
packages/ui         Shared UI primitives and icons
docs/               Migration plan, runbooks, architecture notes
supabase/functions  Legacy Supabase Edge Functions kept until Convex cutover
images/             Legacy static site images
```

The legacy GitHub Pages site still lives at the repository root during the migration. Do not remove it until the Vercel app has been deployed, smoke-tested, and the production domain has been cut over.

## Local Development

Use the bundled or system `pnpm`.

```bash
pnpm install
pnpm web:dev
```

Use Node `24.x`; `.node-version` is included for version managers. The new app runs from `apps/web`. The legacy static site can still be served separately if needed.

## Build And Checks

```bash
pnpm lint
pnpm typecheck
pnpm build
```

## Deployment Direction

Target host: Vercel.

Target Vercel project root: `apps/web`.

Recommended Vercel commands after project linking:

```bash
cd ../.. && pnpm install --frozen-lockfile
cd ../.. && pnpm turbo build --filter=@skyla/web
```

Those commands assume Vercel runs them from the configured `apps/web` project root. If Vercel is configured to run from the repository root instead, omit `cd ../..`.

The current production site is still GitHub Pages at `https://skydeckla.com`. See [docs/migration-plan.md](docs/migration-plan.md) before changing domains or disabling old deployments.

## Sensitive Artifacts

`output/`, `tmp/`, logs, local env files, generated PDFs, and generated CSVs must not be committed. Some existing local artifacts may include PII, invoice links, payment data, or passport form drafts.
