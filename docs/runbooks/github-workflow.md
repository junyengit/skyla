# GitHub Workflow Runbook

## Desired Workflow

1. Create a feature branch.
2. Push changes.
3. Open a pull request.
4. Review the Vercel preview.
5. Require CI, CodeQL, and Vercel to pass.
6. Merge to `main`.
7. Vercel deploys production from `main`.

## Required Repository Settings

- Protect `main`.
- Require pull requests.
- Require strict `ci-build`, `Analyze JavaScript and TypeScript`, and `Vercel`
  checks.
- Block force pushes and branch deletion.
- Require conversation resolution before merge.
- Keep secret scanning and push protection enabled.
- Keep Dependabot vulnerability alerts and automated security fixes enabled.

Current GitHub branch-protection check, verified on July 2, 2026:

- `main` is protected.
- Required checks: `ci-build`, `Analyze JavaScript and TypeScript`, and
  `Vercel`.
- Admins are included in enforcement.
- Force pushes and branch deletion are disabled.
- Conversations must be resolved before merge.
- Dependabot vulnerability alerts and automated security fixes are enabled.
- GitHub Pages is disabled; Vercel is the active deployment surface.

## Current Legacy Behavior

The active hosting path is Vercel from `apps/web`. The old root static site has
been removed from the active tree, so GitHub Pages is no longer the intended
hosting rollback path and is currently disabled.

Treat changes to these paths as production-affecting:

- `apps/web/app/**`
- `apps/web/public/**`
- `apps/web/next.config.mjs`
- `apps/web/vercel.json`
- `supabase/**`
- `convex/**`
- `.github/workflows/**`

Do not merge legacy Supabase/payment changes unless they are reviewed as
production-impacting. Supabase remains a gated legacy backend surface until the
Convex/payment replacement is built and verified.

Run `bun run security:supabase-retired` with the normal security checks after
touching `supabase/functions/**`. The guard keeps the repo copies of the old
Stripe/Kaskade functions retired instead of letting a provider call or Supabase
helper slip back in.
