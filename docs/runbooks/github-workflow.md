# GitHub Workflow Runbook

## Desired Workflow

1. Create a feature branch.
2. Push changes.
3. Open a pull request.
4. Review the Vercel preview.
5. Require CI to pass.
6. Merge to `main`.
7. Vercel deploys production from `main`.

## Required Repository Settings

- Protect `main`.
- Require pull requests.
- Require CI checks.
- Block force pushes.
- Keep secret scanning and push protection enabled.
- Enable Dependabot security updates.

## Current Legacy Behavior

The active hosting path is Vercel from `apps/web`. The old root static site has
been removed from the active tree, so GitHub Pages is no longer the intended
hosting rollback path.

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
