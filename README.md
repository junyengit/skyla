# Skyla

Skyla is now organized as a Turborepo with a Next.js application on Vercel and the legacy static site preserved during the cutover window.

## Repository Layout

```text
apps/web            Next.js App Router application for Vercel
packages/config     Shared site/business constants
packages/ui         Shared UI primitives and icons
docs/               Migration plan, runbooks, architecture notes
docs/audits         Discovery notes and implementation evidence
docs/decisions      Lightweight architecture decision records
supabase/functions  Legacy Supabase Edge Functions kept until Convex cutover
images/             Legacy static site images
```

The legacy GitHub Pages site still lives at the repository root during the migration. Do not remove it until the Vercel app has served the production domain cleanly and rollback is no longer needed.

## Current Hosting State

As of June 30, 2026:

- Vercel project `junyen-enterprises/web` deploys `apps/web` from `main`.
- The QA/security baseline is merged. The most recently verified application production deployment is `https://web-gq0o1xfqu-junyen-enterprises.vercel.app` from commit `7bfe12a6e3263bab1357b1fd28946873e29642e1`.
- Vercel custom domains `skydeckla.com` and `www.skydeckla.com` are attached and Vercel reports both domains as configured correctly.
- Nameservers now resolve to Vercel DNS: `ns1.vercel-dns.com` and `ns2.vercel-dns.com`.
- Custom-domain smoke tests pass on both the apex domain and `www` without DNS overrides.
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
pnpm test:unit
pnpm build
pnpm security:artifacts
pnpm security:audit
```

For a full local gate that matches the migration baseline:

```bash
pnpm check
SMOKE_BASE_URL=https://skydeckla.com pnpm test:smoke
SMOKE_BASE_URL=https://www.skydeckla.com pnpm test:smoke
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

The Vercel production route matrix passes on the custom domains. Keep GitHub Pages available as rollback until the team explicitly retires it after the App Router, Convex, payment, admin, and POS migrations are complete. See [docs/phase-2-roadmap.md](docs/phase-2-roadmap.md) for the next migration phase and [docs/runbooks/domain-cutover.md](docs/runbooks/domain-cutover.md) before disabling old deployments.

## Sensitive Artifacts

`output/`, `tmp/`, logs, local env files, generated PDFs, and generated CSVs must not be committed. Some existing local artifacts may include PII, invoice links, payment data, or passport form drafts.
