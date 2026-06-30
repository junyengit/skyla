# Review Checklist

Use this after each major phase.

## Code

- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
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

## Deployment

- Vercel preview builds
- Build logs are clean
- Production domain is not changed without approval
- Old deployment is not disabled before cutover verification
