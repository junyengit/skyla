# Decision 0001: Adopt Bun Canary In A Dedicated PR

Date: 2026-06-30

## Status

Accepted for implementation in branch `codex/bun-canary-root-cleanup`.

## Decision

Skyla will replace pnpm with Bun canary for local installs, GitHub CI, and the
Vercel build pipeline in a dedicated PR. The committed lockfile must be the text
`bun.lock`; `bun.lockb` must not be used.

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

## Implementation Notes

- Last verified local Bun revision: `1.4.0-canary.1+ffea69ae7`.
- Root `package.json` records `packageManager: bun@1.4.0-canary.1` and
  workspace globs for `apps/*` and `packages/*`.
- CI uses `oven-sh/setup-bun@v2` with `bun-version: canary`.
- Vercel uses `apps/web/vercel.json` plus
  `scripts/setup/vercel-install-bun-canary.sh` to install/upgrade canary before
  frozen install.
- CI and Vercel intentionally use the moving latest-canary channel. The root
  `packageManager` records the last verified canary, and `bun install
  --frozen-lockfile` is the guardrail if a newer canary changes lock behavior.
- Vercel `bunVersion` accepts `1.x`, so it is used for runtime compatibility,
  while the build canary is enforced by the install script.
- `bun audit --audit-level=high` replaces `pnpm audit --audit-level=high`.
- Turbo `2.10.1` currently warns that Bun canary lockfile version 2 is not fully
  parsed for lockfile analysis. Tasks still run and pass. This is an accepted
  canary risk until Turbo supports that lockfile format or Bun stabilizes it.

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
