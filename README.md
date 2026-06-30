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
- Current Vercel production deployment is `https://web-hc38hldhg-junyen-enterprises.vercel.app` from commit `d8da1e3c8ac653f6143aa456debec84069b0ea60`.
- Vercel custom domains `skydeckla.com` and `www.skydeckla.com` are attached and Vercel reports both domains as configured correctly.
- Nameservers now resolve to Vercel DNS: `ns1.vercel-dns.com` and `ns2.vercel-dns.com`.
- Public DNS propagation may still be uneven immediately after the nameserver switch. External DNS and direct Vercel-edge checks route to Vercel, while local OS/browser DNS caches may briefly retain old GitHub Pages answers.
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

The Vercel production route matrix has passed on the Vercel deployment URL, and Vercel verifies the custom domains. Keep GitHub Pages available as rollback until public DNS cache behavior has settled and custom-domain smoke tests pass without DNS overrides. See [docs/phase-2-roadmap.md](docs/phase-2-roadmap.md) for the next migration phase and [docs/runbooks/domain-cutover.md](docs/runbooks/domain-cutover.md) before disabling old deployments.

## Sensitive Artifacts

`output/`, `tmp/`, logs, local env files, generated PDFs, and generated CSVs must not be committed. Some existing local artifacts may include PII, invoice links, payment data, or passport form drafts.
