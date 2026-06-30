# Decision 0002: Remove Root Static Duplicates After Vercel Cutover

Date: 2026-06-30

## Status

Accepted for implementation in branch `codex/bun-canary-root-cleanup`.

## Decision

Root legacy static duplicates are removed from the active tree. The canonical
static compatibility pages and images now live under `apps/web/public`, where
the Vercel app serves them intentionally.

Hosting rollback should use prior Vercel deployments, not the repository root
or GitHub Pages static files.

## Context

Before this decision, the repo contained both:

- root GitHub Pages static files
- `apps/web/public` compatibility files used by Vercel

That duplication made it unclear which files were active and increased the risk
of accidental edits to the wrong copy. Vercel custom-domain smoke tests now pass
without DNS overrides, and production rollback can be handled by Vercel's prior
deployment history.

This decision does not remove the legacy compatibility bridge inside
`apps/web/public`. It also does not remove Supabase functions, because payment,
admin, POS, and data flows still need a verified Convex/server-authoritative
replacement before those backend surfaces are disabled.

## Consequences

Good:

- Makes the repository root readable again.
- Prevents root and app-public copies from drifting.
- Keeps SEO and legacy public links stable through the app-owned compatibility bridge.
- Aligns the active asset boundary with the Vercel app.

Risks:

- GitHub Pages root-static rollback is no longer available after this merges.
- The `apps/web/public` compatibility bridge still carries legacy client-side
  payment/admin risks until the App Router and Convex rebuilds replace it.

Implementation rule:

- Treat `apps/web/public/images/` as canonical active assets now.
- Keep `apps/web/public` compatibility files until each route has a tested App
  Router replacement or redirect.
- Treat Supabase function removal as a later backend migration step, not a root
  cleanup step.
