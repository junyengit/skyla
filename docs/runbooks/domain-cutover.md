# Domain Cutover Runbook

## Goal

Move `skydeckla.com` and `www.skydeckla.com` from GitHub Pages to Vercel with a clean rollback path.

## Current State

- Registrar: GoDaddy.
- DNS host: Vercel nameservers `ns1.vercel-dns.com` and `ns2.vercel-dns.com`.
- Current Vercel verification reports both `skydeckla.com` and `www.skydeckla.com` as configured correctly.
- Custom-domain smoke tests pass for the apex and `www` without DNS overrides.
- Last known GitHub Pages rollback values are apex A records `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, and `185.199.111.153`, plus `www.skydeckla.com` CNAME `junyengit.github.io.`
- Existing TXT records include `apple-domain-verification=UKchr7KlrHJiCids` and `brevo-code:bf64ac1498536c7d801c996cabb36ea8`. Preserve TXT records during any DNS change.
- No AAAA records were observed. Do not add AAAA records for Vercel.

Historical note: immediately after the nameserver switch, local OS/browser DNS caches briefly returned stale GitHub Pages behavior while Vercel and external DNS were already correct.

## Vercel Domain State

As of June 30, 2026, both `skydeckla.com` and `www.skydeckla.com` have been added to Vercel project `junyen-enterprises/web`, Vercel reports both as configured correctly, and GoDaddy is pointed at Vercel nameservers.

With Vercel nameservers active, do not edit apex A records or the `www` CNAME in GoDaddy. Manage domain routing in Vercel Project Settings.

If moving away from Vercel nameservers to third-party DNS, Vercel previously reported these DNS targets for this project:

- Apex A records: `216.198.79.1` and `64.29.17.1`
- `www` CNAME: `2c6615fa9eaccf36.vercel-dns-017.com.`

Verify these values in Vercel immediately before using third-party DNS. If Vercel shows different records, use the current Vercel values.

## Cutover Verification

- [x] Vercel production deployment is READY from `main`.
- [x] The route matrix passes on the Vercel production URL, apex domain, and `www` domain:
  - `/`
  - `/about`
  - `/cafe`
  - `/experiences`
  - `/checkout`
  - `/members`
  - `/privacy`
  - `/terms`
  - `/admin`
  - `/pos`
  - `/robots.txt`
  - `/sitemap.xml`
- [x] `/admin`, `/admin.html`, `/pos`, and `/pos.html` include `X-Robots-Tag: noindex, nofollow`.
- [x] Payment and booking flows are intentionally operating in the documented legacy bridge mode.

## Current Nameserver Flow

Use this if GoDaddy remains delegated to Vercel nameservers:

1. Manage `skydeckla.com` and `www.skydeckla.com` in Vercel Project Settings > Domains.
2. Preserve existing TXT records in Vercel DNS.
3. Run production smoke tests after any deployment or DNS change:
   - `SMOKE_BASE_URL=https://skydeckla.com pnpm test:smoke`
   - `SMOKE_BASE_URL=https://www.skydeckla.com pnpm test:smoke`
4. Keep GitHub Pages available until explicit rollback retirement.

## Third-Party DNS Fallback

Use this only if moving from Vercel nameservers back to GoDaddy DNS or another DNS host while keeping Vercel hosting:

1. Confirm both domains are present in the Vercel project.
2. Keep `skydeckla.com` as the primary domain initially because the legacy canonicals point to the apex.
3. Read Vercel's required DNS records from Project Settings > Domains.
4. Lower DNS TTL in GoDaddy if the provider supports it.
5. Replace the apex GitHub Pages A records with Vercel's required A records.
6. Replace `www.skydeckla.com` CNAME from `junyengit.github.io.` to Vercel's provided CNAME target.
7. Preserve all TXT records.
8. Do not add AAAA records.
9. Verify Vercel domain status, HTTPS certificate issuance, and apex/`www` redirects.
10. Smoke-test production.
11. Keep GitHub Pages available until Vercel has served production cleanly for at least one DNS propagation window, preferably 24-48 hours.
12. Disable GitHub Pages only after explicit confirmation.

Required records if using third-party DNS:

- `A` record: `@` -> `216.198.79.1`
- `A` record: `@` -> `64.29.17.1`
- `CNAME` record: `www` -> `2c6615fa9eaccf36.vercel-dns-017.com.`

Remove the GitHub Pages apex A records when adding the Vercel A records. Preserve TXT, Brevo CNAME, and `pay` records.

## GitHub Pages Rollback

Rollback to GitHub Pages by moving DNS hosting or records back to GitHub Pages values:

- Apex A records: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
- `www` CNAME: `junyengit.github.io.`

Then verify HTTPS and redirects again after propagation.

## GitHub Pages Shutdown

Do not disable GitHub Pages during the migration. Use it as rollback until backend/payment/admin/POS migration and explicit rollback retirement are complete.

1. Keep the old DNS values recorded.
2. After rollback is retired, open GitHub repository Settings > Pages.
3. Prefer unpublishing the current Pages site first.
4. Later, set Pages source to `None` when rollback is no longer needed.
5. Do not delete the root static site files or `CNAME` until a separate cleanup phase.

## Verification

Check these before declaring cutover done:

- `https://skydeckla.com`
- `https://www.skydeckla.com`
- `/checkout` or its migrated replacement
- `/members` or its migrated replacement
- `/privacy`
- `/terms`
- Admin/POS routes return an intentional login or disabled state.
