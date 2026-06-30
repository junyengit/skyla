# Security Policy

## Reporting

Report suspected Skyla security issues privately to `reservations@skydeckla.com` until a dedicated security mailbox is configured.

Do not open public issues for vulnerabilities involving payments, staff access, booking data, customer data, secrets, or provider webhooks.

## Current Migration Risks

The project is in a staged migration from legacy static/Supabase flows to Next.js, Vercel, and Convex. Known areas that must stay under review:

- Client-authoritative checkout and POS totals.
- Supabase-era payment and webhook functions.
- Admin/POS authorization.
- Stored-XSS surfaces in legacy bridge scripts.
- Generated exports under ignored paths such as `output/` and `tmp/`.

## Baseline Checks

Run before merging security-sensitive changes:

```bash
pnpm check
pnpm security:artifacts
pnpm security:audit
```

Run route smoke checks after deployments:

```bash
SMOKE_BASE_URL=https://skydeckla.com pnpm test:smoke
SMOKE_BASE_URL=https://www.skydeckla.com pnpm test:smoke
```
