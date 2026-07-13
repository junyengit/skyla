# Decision 0001: Adopt Bun Canary In A Dedicated PR

Date: 2026-06-30

## Status

Accepted and merged in PR #10.

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

Bun documents `bun upgrade --canary` as the way to follow its moving canary
channel. That command is useful when evaluating a new candidate, but it is not
an acceptable production install command because it changes without a repo
change. Skyla therefore commits the reviewed archive revision and SHA-256 for
each supported build platform. Reviewed archives are copied to a unique Skyla
toolchain release tag. The installer downloads that fixed release asset as
data, verifies the digest and `bun --revision`, and only then installs it.

The pin-refresh workflow is:

```bash
bun upgrade --canary
bun --revision
bash scripts/setup/vercel-install-bun-canary.sh
bun run check
```

The first two commands are discovery only. Updating the constants in
`scripts/setup/vercel-install-bun-canary.sh` after publishing a new uniquely
tagged Skyla toolchain release is the reviewed change that moves local
development, CI, and Vercel.

Turborepo should use text lockfile analysis, so the repo should commit `bun.lock`, not binary-only `bun.lockb`.

## Implementation Notes

- Reviewed canary version: `1.4.0-canary.1`.
- Linux x64, used by GitHub CI and Vercel, is pinned to revision
  `1.4.0-canary.1+8f1a9540f` and archive SHA-256
  `21cd632ff9a5a1277a0586f0581f85419bf909ba496b18328af0a35cbf065711`.
- macOS arm64, used by the current local workstation, is pinned to revision
  `1.4.0-canary.1+a59a9c37b` and archive SHA-256
  `a69e4b62ab1dfa395d96cec9e3ac787571a77203c75b06a18216777bcf461b4b`.
- Root `package.json` records `packageManager: bun@1.4.0-canary.1` and
  workspace globs for `apps/*` and `packages/*`.
- Both CI jobs and Vercel call
  `scripts/setup/vercel-install-bun-canary.sh`, so the production build and CI
  use the same exact Linux binary and frozen dependency install.
- The archive mirror is the fixed Skyla release
  `toolchain-bun-1.4.0-canary.1-8f1a9540f`, which also contains `SHA256SUMS`.
- The installer does not execute a downloaded shell script and does not
  self-upgrade or fetch Bun's moving `canary` release URL. The current mirror
  predates repository release immutability; its checksums prevent undetected
  substitution, while enabling release immutability before the next toolchain
  publication will also prevent deletion or replacement through GitHub.
- Vercel `bunVersion` accepts `1.x`, so it is used for runtime compatibility,
  while the exact build-time canary is enforced by the install script. Vercel
  manages the Functions runtime minor and patch version separately.
- `bun audit --audit-level=high` replaces `pnpm audit --audit-level=high`.
- Turbo `2.10.4` and the current text `bun.lock` no longer emit the previous
  unsupported lockfile-version warning in `bun run check`. Treat future Bun
  canary lockfile-format changes as a focused dependency PR, not a drive-by
  migration.

## Consequences

Good:

- Faster installs and scripts if the canary is stable for this app.
- One package manager across local, CI, and Vercel.
- Cleaner future developer onboarding after the migration settles.

Risks:

- Canary builds can break unexpectedly.
- Next.js, Vercel, and Convex tooling may expose compatibility gaps.
- A package-manager switch can obscure unrelated app migration failures.
- The fixed mirror is an availability dependency. The current release can still
  be deleted by a repository owner until release immutability is enabled for
  future releases; checksum and revision checks still prevent changed bytes
  from being accepted.

Official references:

- [Bun installation and canary builds](https://bun.com/docs/installation)
- [Bun canary release assets](https://github.com/oven-sh/bun/releases/tag/canary)
- [Skyla reviewed Bun mirror](https://github.com/junyengit/skyla/releases/tag/toolchain-bun-1.4.0-canary.1-8f1a9540f)
- [GitHub immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)
- [Vercel exact Bun build pinning](https://vercel.com/kb/guide/how-to-pin-a-specific-bun-version-for-vercel-builds)
- [Vercel Bun Functions runtime](https://vercel.com/docs/functions/runtimes/bun)
- [Vercel package-manager detection](https://vercel.com/docs/package-managers)

Rollback:

- Revert the Bun PR.
- Restore `pnpm-lock.yaml`, `packageManager: pnpm@11.9.0`, pnpm CI setup, and pnpm Vercel commands.
