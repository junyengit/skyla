# Local Development Runbook

## New Vercel App

Use Node `24.x`.

```bash
pnpm install
pnpm web:dev
```

The Next.js app lives in `apps/web`. Private workspace packages export source files for local development, while `pnpm build` still emits `dist/` artifacts as a CI verification step.

## Legacy Static Site

The legacy root files are preserved during migration. If needed:

```bash
python3 -m http.server 8765
```

Open `http://127.0.0.1:8765/index.html`.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm build
```

## Do Not Commit

- `output/`
- `tmp/`
- `.env*`
- logs
- generated PDFs/CSVs
