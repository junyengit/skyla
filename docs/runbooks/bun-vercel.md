# Bun And Vercel Runbook

## Goal

Adopt Bun for Skyla without making the deployment pipeline ambiguous.

The desired end state is:

- Bun is the repo package manager.
- CI installs and runs checks with Bun.
- Vercel uses the same install/build behavior as CI.
- Turborepo can read a text `bun.lock`.
- Rollback to pnpm remains documented until Bun canary is proven stable on
  production previews.

## Current State

- The repo uses Bun canary with a committed text `bun.lock`.
- Last verified local Bun revision: `1.4.0-canary.1+1de77f961`.
- CI uses `oven-sh/setup-bun@v2` with `bun-version: canary`.
- Vercel project `junyen-enterprises/web` is configured for `apps/web`.
- Vercel install/build commands are committed in `apps/web/vercel.json`.
- Turborepo `2.10.4` runs the task graph against the current text `bun.lock`
  without the previous unsupported lockfile-version warning.

CI and Vercel intentionally follow the latest Bun canary channel. If a future
canary changes lockfile behavior, `bun install --frozen-lockfile` should fail
and the lockfile should be refreshed in a follow-up PR.

## Canary Install

Use Bun's canary upgrade command locally:

```bash
bun upgrade --canary
```

Then verify:

```bash
bun --version
bun --revision
bun install --frozen-lockfile
bun run check
bun run security:audit
```

Do not commit a binary-only `bun.lockb`. The repo should use `bun.lock` so Turborepo can do granular lockfile analysis.

## Package Manager Switch Checklist

1. Create a branch.
2. Install Bun canary locally.
3. Generate `bun.lock`.
4. Remove `pnpm-lock.yaml` and `pnpm-workspace.yaml` only after Bun install succeeds.
5. Update root `package.json`:
   - `packageManager`
   - `workspaces`
   - `trustedDependencies`
   - scripts currently hardcoded to `pnpm`
6. Update package scripts only where needed.
7. Update CI from pnpm setup/install to Bun setup/install.
8. Update Vercel install/build commands.
9. Run local checks.
10. Deploy a Vercel preview.
11. Smoke-test preview before production.

## Vercel Settings To Verify

Project: `junyen-enterprises/web`

Recommended settings after Bun migration:

- Root directory: `apps/web`
- Framework preset: Next.js
- Install command: `cd ../.. && bash scripts/setup/vercel-install-bun-canary.sh`
- Build command: `cd ../.. && export PATH="$HOME/.bun/bin:$PATH" && bun --revision && bun run web:build`
- Runtime: `bunVersion: "1.x"` in `apps/web/vercel.json`

If using `vercel.json` from the repository root, make sure the config applies to the `apps/web` project root as intended. Do not keep conflicting dashboard and repo settings without documenting which wins.

## Bun/Turbo Watch Item

The old Bun canary/Turbo caveat was retired on July 7, 2026. Dependabot PR
#109 upgraded Turbo to `2.10.4` and regenerated `bun.lock` with
`lockfileVersion: 1`; `bun run check` no longer prints:

```text
Unsupported bun lockfile version: 2
```

Keep watching this because CI and Vercel intentionally follow the moving Bun
canary channel. If Bun changes the text lockfile format again, refresh the
lockfile in its own small PR and verify `bun run check` before merging.

## Rollback

Rollback path before merging:

- Restore `packageManager` to `pnpm@11.9.0`.
- Restore `pnpm-lock.yaml`.
- Remove `bun.lock`.
- Restore CI setup to pnpm.
- Restore Vercel install/build commands to pnpm.

Rollback path after merging:

- Revert the Bun migration commit.
- Confirm Vercel production redeploys from the reverted commit.
- Keep any Bun-specific cache or dashboard setting documented until removed.

## Why This Is Deliberate

Bun can make installs and scripts faster, but Skyla is currently in a production hosting migration. Package-manager changes affect local development, CI, Vercel builds, and Turborepo cache behavior. Treating Bun as its own migration slice keeps the app deployable while the deeper Convex and payment work proceeds.
