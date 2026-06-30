# Bun And Vercel Runbook

## Goal

Adopt Bun for Skyla without making the deployment pipeline ambiguous.

The desired end state is:

- Bun is the repo package manager.
- CI installs and runs checks with Bun.
- Vercel uses the same install/build behavior as CI.
- Turborepo can read a text `bun.lock`.
- Rollback to pnpm is still possible until Bun canary is proven stable.

## Current State

- The repo currently uses `pnpm@11.9.0`.
- CI uses `pnpm/action-setup` and `pnpm install --frozen-lockfile`.
- Vercel project `junyen-enterprises/web` is configured for `apps/web`.
- Turborepo is already present and supports Bun text lockfiles.

## Canary Install

Use Bun's canary upgrade command locally:

```bash
bun upgrade --canary
```

Then verify:

```bash
bun --version
bun install --save-text-lockfile
bun run check
```

Do not commit a binary-only `bun.lockb`. The repo should use `bun.lock` so Turborepo can do granular lockfile analysis.

## Package Manager Switch Checklist

1. Create a branch.
2. Install Bun canary locally.
3. Generate `bun.lock`.
4. Update root `package.json`:
   - `packageManager`
   - scripts currently hardcoded to `pnpm`
5. Update package scripts only where needed.
6. Update CI from pnpm setup/install to Bun setup/install.
7. Update Vercel install/build commands.
8. Run local checks.
9. Deploy a Vercel preview.
10. Smoke-test preview before production.

## Vercel Settings To Verify

Project: `junyen-enterprises/web`

Recommended settings after Bun migration:

- Root directory: `apps/web`
- Framework preset: Next.js
- Install command: `cd ../.. && bun install --frozen-lockfile`
- Build command: `cd ../.. && bun run build --filter=@skyla/web` or an equivalent root Turborepo command verified in preview
- Runtime: set `bunVersion` in Vercel config only after confirming it works for the app's serverless/runtime needs

If using `vercel.json` from the repository root, make sure the config applies to the `apps/web` project root as intended. Do not keep conflicting dashboard and repo settings without documenting which wins.

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
