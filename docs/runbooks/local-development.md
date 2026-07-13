# Local Development Runbook

## New Vercel App

Use Node `24.x` and the repo-reviewed Bun canary pin. On the current macOS
arm64 workstation that is `1.4.0-canary.1+a59a9c37b`; CI and Vercel use the
separately checksum-pinned Linux x64 build recorded in the Bun/Vercel runbook.

```bash
bash scripts/setup/vercel-install-bun-canary.sh
bun install --frozen-lockfile
bun run web:dev
```

Do not self-upgrade Bun as part of normal setup. Use the upstream moving canary
command only to discover a candidate for a focused pin-and-mirror PR; normal
setup must keep using the fixed Skyla toolchain release.

The Next.js app lives in `apps/web`. Private workspace packages export source
files for local development, while `bun run build` still emits `dist/`
artifacts as a CI verification step.

## Compatibility Routes

Saved legacy URLs are defined in `apps/web/site-routes.mjs`; compatibility HTML
does not live at the repository root or in `apps/web/public`. Use the Next app
to test the native routes and saved-link redirects:

- `http://127.0.0.1:3000/about`
- `http://127.0.0.1:3000/checkout`
- `http://127.0.0.1:3000/admin`
- `http://127.0.0.1:3000/pos`

## Checks

```bash
bun run lint
bun run typecheck
bun run test:unit
bun run build
bun run security
bun run check
```

Turbo `2.10.5` currently runs the task graph against the text `bun.lock`
without the old unsupported lockfile-version warning. If a future Bun canary
changes the lockfile format, regenerate the lockfile in a focused PR and rerun
`bun run check`.

## Do Not Commit

- `output/`
- `tmp/`
- `.env*`
- logs
- generated PDFs/CSVs
