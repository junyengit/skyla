# Skyla

Skyla is now organized as a Turborepo with a Next.js application on Vercel and the legacy static site preserved during the cutover window.

## Repository Layout

```text
apps/web            Next.js App Router application for Vercel
packages/config     Shared site/business constants
packages/ui         Shared UI primitives and icons
docs/               Migration plan, runbooks, architecture notes
supabase/functions  Legacy Supabase Edge Functions kept until Convex cutover
images/             Legacy static site images
```

The legacy GitHub Pages site still lives at the repository root during the migration. Do not remove it until the Vercel app has served the production domain cleanly and rollback is no longer needed.

## Current Hosting State

As of June 30, 2026:

- GitHub Pages still serves `https://skydeckla.com` through GoDaddy DNS.
- Vercel project `junyen-enterprises/web` deploys `apps/web` from `main`.
- Vercel custom domains `skydeckla.com` and `www.skydeckla.com` are attached, but DNS has not been cut over yet.
- The Next app serves the new homepage and bridges legacy routes from `/about`, `/cafe`, `/experiences`, `/checkout`, `/members`, `/privacy`, `/terms`, `/admin`, and `/pos` to static compatibility pages in `apps/web/public`.

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

The current public domain is still on GitHub Pages until the Vercel route matrix passes and GoDaddy DNS is intentionally updated. See [docs/runbooks/domain-cutover.md](docs/runbooks/domain-cutover.md) before changing domains or disabling old deployments.

## Sensitive Artifacts

`output/`, `tmp/`, logs, local env files, generated PDFs, and generated CSVs must not be committed. Some existing local artifacts may include PII, invoice links, payment data, or passport form drafts.
