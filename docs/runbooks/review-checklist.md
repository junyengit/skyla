# Review Checklist

Use this after each major phase.

## Code

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test:unit`
- `pnpm build`
- `pnpm security:artifacts`
- `pnpm security:audit`
- `pnpm check`
- No accidental generated artifacts in `git status`
- No secrets in source
- No new client-trusted payment authority

## Product

- Homepage loads
- Core navigation works
- Legal pages are reachable
- Ticket path is safe
- Admin/POS are not indexed
- Motion respects reduced motion
- Legacy route bridge still covers `/about`, `/cafe`, `/experiences`, `/checkout`, `/members`, `/privacy`, `/terms`, `/admin`, and `/pos`

## Deployment

- Vercel preview builds
- Build logs are clean
- Preview smoke: `SMOKE_BASE_URL=<preview-url> pnpm test:smoke`
- Production apex smoke: `SMOKE_BASE_URL=https://skydeckla.com pnpm test:smoke`
- Production `www` smoke: `SMOKE_BASE_URL=https://www.skydeckla.com pnpm test:smoke`
- Production domain is not changed without approval
- Old deployment is not disabled before cutover verification

## Why These Gates Exist

- Unit tests protect shared pricing/contact constants and the temporary legacy-route bridge while the app is rebuilt.
- The artifact guard stops local exports, logs, PDFs, env files, and obvious secrets from reaching GitHub or Vercel.
- The smoke script is intentionally simple: it checks every transition route still returns `200`, and it verifies admin/POS compatibility pages carry `X-Robots-Tag: noindex, nofollow`.
- `pnpm security:audit` currently fails only on high or critical advisories across production and dev tooling; the known `postcss` advisory is moderate and remains tracked separately until the dependency sweep.
