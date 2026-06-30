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

- Vercel project `junyen-enterprises/web` deploys `apps/web` from `main`.
- Current Vercel production deployment is `https://web-istczvmf1-junyen-enterprises.vercel.app` from commit `f3c99649ea87a9b94e40bdc3e7de35f1ea98e923`.
- Vercel custom domains `skydeckla.com` and `www.skydeckla.com` are attached, but GoDaddy DNS still needs the Vercel records saved and verified before the custom domains are considered live.
- Current DNS checks show `www.skydeckla.com` still resolving through GitHub Pages and apex `skydeckla.com` not resolving from this environment. Treat the public custom domain as mid-cutover until GoDaddy DNS is corrected.
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

The Vercel production route matrix has passed on the Vercel deployment URL, but the custom domain is not verified until GoDaddy DNS points to Vercel. See [docs/runbooks/domain-cutover.md](docs/runbooks/domain-cutover.md) before changing domains or disabling old deployments.

## Sensitive Artifacts

`output/`, `tmp/`, logs, local env files, generated PDFs, and generated CSVs must not be committed. Some existing local artifacts may include PII, invoice links, payment data, or passport form drafts.
