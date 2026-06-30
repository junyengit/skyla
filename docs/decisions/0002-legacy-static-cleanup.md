# Decision 0002: Retire Root Static Files After Rollback Window

Date: 2026-06-30

## Status

Proposed

## Decision

Root legacy static files should not be deleted immediately. They should be moved to `legacy-static/public-site/` or removed only after:

- GitHub Pages rollback is explicitly retired.
- The equivalent public routes exist as App Router pages or intentional redirects.

## Context

The repo currently contains both:

- root GitHub Pages static files
- `apps/web/public` compatibility files used by Vercel

That duplication is confusing, but it also provides rollback while the backend, payment, admin, POS, and route migrations finish. Vercel custom-domain smoke tests now pass without DNS overrides, so rollback retirement is the remaining cleanup gate.

## Consequences

Good:

- Avoids breaking the old GitHub Pages deployment while it is still useful as rollback.
- Gives the Next/Convex migration room to replace routes one by one.
- Keeps SEO and legacy public links stable during the transition.

Risks:

- The repo remains noisier until the cleanup phase.
- Root and compatibility copies can drift if edited independently.

Implementation rule:

- Treat `apps/web/public/images/` as canonical active assets now.
- Treat root `images/` as duplicate rollback/archive material.
- Move root static files only in a dedicated cleanup PR.
