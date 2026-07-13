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
- The reviewed canary version is `1.4.0-canary.1`.
- GitHub CI and Vercel Linux x64 builds are pinned to
  `1.4.0-canary.1+8f1a9540f` with archive SHA-256
  `21cd632ff9a5a1277a0586f0581f85419bf909ba496b18328af0a35cbf065711`.
- The current macOS arm64 workstation is pinned to
  `1.4.0-canary.1+a59a9c37b` with archive SHA-256
  `a69e4b62ab1dfa395d96cec9e3ac787571a77203c75b06a18216777bcf461b4b`.
- Both CI jobs use the same checksum-verifying installer as Vercel.
- Every platform archive is served from Skyla release
  `toolchain-bun-1.4.0-canary.1-8f1a9540f`, a unique tag created for this
  reviewed matrix. Builds never download from Bun's moving `canary` URL.
- Bun's official canary assets were published asynchronously at this snapshot,
  so the semantic canary version is shared while the reviewed Linux x64 and
  macOS arm64 commit revisions differ. The platform digest matrix, not the
  moving release label, is authoritative.
- Vercel project `junyen-enterprises/web` is configured for `apps/web`.
- Vercel install/build commands are committed in `apps/web/vercel.json`.
- Turborepo `2.10.5` runs the task graph against the current text `bun.lock`
  without the previous unsupported lockfile-version warning.

CI and Vercel do not follow a moving channel during a build. The pin was
selected from Bun's current canary lineage, copied to the uniquely tagged
[Skyla toolchain release](https://github.com/junyengit/skyla/releases/tag/toolchain-bun-1.4.0-canary.1-8f1a9540f),
and locked by committed revision and archive digest. The current release predates
repository-level release immutability, so an owner could still delete it;
checksum and revision verification prevent a changed archive from being used
silently. Enable release immutability before publishing the next toolchain pin.

## Canary Install

Install the repo-reviewed pin locally with the same script used by CI and
Vercel:

```bash
bash scripts/setup/vercel-install-bun-canary.sh
```

Then verify:

```bash
bun --version
bun --revision
bun install --frozen-lockfile
bun run check
bun run security:audit
```

To evaluate a newer canary, use `bun upgrade --canary` only as a discovery
step. Record `bun --revision`, download every supported archive from Bun's
official GitHub release, verify it, and publish the reviewed files plus a
`SHA256SUMS` manifest under a new unique Skyla toolchain release tag. Update the
complete release/revision/digest matrix in the installer and submit that change
with a lockfile diff and full CI. Never put the discovery command or Bun's
moving `canary` asset URL back into Vercel or CI.

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
- Build command: `cd ../.. && export PATH="$HOME/.bun/bin:$PATH" && bun --revision && bun run build --filter=@skyla/web`
- Runtime: `bunVersion: "1.x"` in `apps/web/vercel.json`

`bunVersion: "1.x"` controls Vercel's Bun Functions runtime, whose minor and
patch versions Vercel manages. It does not replace the exact build-time canary
pin in the install script.

If using `vercel.json` from the repository root, make sure the config applies to the `apps/web` project root as intended. Do not keep conflicting dashboard and repo settings without documenting which wins.

## Bun/Turbo Watch Item

The old Bun canary/Turbo caveat was retired on July 7, 2026. Dependabot PR
#109 upgraded Turbo to `2.10.4` and regenerated `bun.lock` with
`lockfileVersion: 1`; `bun run check` no longer prints:

```text
Unsupported bun lockfile version: 2
```

Keep watching this when deliberately refreshing the canary pin. If Bun changes
the text lockfile format again, refresh the pin and lockfile together in their
own small PR and verify `bun run check` before merging.

## Official References

- [Bun installation and canary builds](https://bun.com/docs/installation)
- [Bun canary release assets](https://github.com/oven-sh/bun/releases/tag/canary)
- [Vercel exact Bun build pinning](https://vercel.com/kb/guide/how-to-pin-a-specific-bun-version-for-vercel-builds)
- [Vercel Bun Functions runtime](https://vercel.com/docs/functions/runtimes/bun)
- [Vercel package managers](https://vercel.com/docs/package-managers)

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
