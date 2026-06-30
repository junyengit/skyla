# Decision 0001: Evaluate Bun Canary In A Dedicated PR

Date: 2026-06-30

## Status

Proposed

## Decision

Skyla will evaluate Bun canary as a separate migration slice before replacing pnpm on `main`.

## Context

The current production migration already touches hosting, routing, data, payments, and repo layout. Bun can improve install and script speed, but it also affects:

- local developer commands
- lockfile behavior
- Turborepo cache invalidation
- GitHub Actions setup
- Vercel install and build commands
- Vercel function runtime behavior if `bunVersion` is used

Bun canary should be installed with:

```bash
bun upgrade --canary
```

Turborepo should use text lockfile analysis, so the repo should commit `bun.lock`, not binary-only `bun.lockb`.

## Consequences

Good:

- Faster installs and scripts if the canary is stable for this app.
- One package manager across local, CI, and Vercel.
- Cleaner future developer onboarding after the migration settles.

Risks:

- Canary builds can break unexpectedly.
- Next.js, Vercel, and Convex tooling may expose compatibility gaps.
- A package-manager switch can obscure unrelated app migration failures.

Rollback:

- Revert the Bun PR.
- Restore `pnpm-lock.yaml`, `packageManager: pnpm@11.9.0`, pnpm CI setup, and pnpm Vercel commands.
