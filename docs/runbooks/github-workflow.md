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

Before cutover, GitHub Pages deploys the root static site from `main`. Do not rely on this as the long-term deployment path.

Until GitHub Pages is unpublished, merging to `main` can still publish root-level static file changes immediately. Treat changes to these paths as production-affecting:

- `*.html`
- `checkout.js`
- `shared-data.js`
- `ads-tracking.js`
- `CNAME`
- `supabase/**`

Do not merge foundation-only work to `main` with root static or legacy Supabase changes unless those legacy production changes have been reviewed and are intended to ship before Vercel cutover.
