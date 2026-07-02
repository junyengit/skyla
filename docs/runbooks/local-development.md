# Local Development Runbook

## New Vercel App

Use Node `24.x` and Bun canary. The last verified local Bun revision is
`1.4.0-canary.1+eba370b69`.

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

Turbo currently warns that Bun canary `bun.lock` version 2 is not fully parsed
for lockfile analysis. The tasks still run and pass. Treat that warning as a
known canary integration risk until Turbo adds lockfile v2 support or Bun
stabilizes the format.

## Do Not Commit

- `output/`
- `tmp/`
- `.env*`
- logs
- generated PDFs/CSVs
