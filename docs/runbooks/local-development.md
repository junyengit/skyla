# Local Development Runbook

## New Vercel App

Use Node `24.x` and Bun canary. The last verified local Bun revision is
`1.4.0-canary.1+1de77f961`.

```bash
bun upgrade --canary
bun install --frozen-lockfile
bun run web:dev
```

The Next.js app lives in `apps/web`. Private workspace packages export source
files for local development, while `bun run build` still emits `dist/`
artifacts as a CI verification step.

## Compatibility Pages

Legacy compatibility pages live in `apps/web/public`, not at the repository
root. Use the Next app to test them:

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

Turbo `2.10.4` currently runs the task graph against the text `bun.lock`
without the old unsupported lockfile-version warning. If a future Bun canary
changes the lockfile format, regenerate the lockfile in a focused PR and rerun
`bun run check`.

## Do Not Commit

- `output/`
- `tmp/`
- `.env*`
- logs
- generated PDFs/CSVs
