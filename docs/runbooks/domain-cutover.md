# Domain Cutover Runbook

## Goal

Keep `skydeckla.com` and `www.skydeckla.com` on Vercel with a clean rollback
path through prior Vercel deployments.

## Current State

- Registrar: GoDaddy.
- DNS host: Vercel nameservers `ns1.vercel-dns.com` and `ns2.vercel-dns.com`.
- Current Vercel verification reports both `skydeckla.com` and `www.skydeckla.com` as configured correctly.
- Custom-domain smoke tests pass for the apex and `www` without DNS overrides.
- Historical GitHub Pages values were apex A records `185.199.108.153`,
  `185.199.109.153`, `185.199.110.153`, and `185.199.111.153`, plus
  `www.skydeckla.com` CNAME `junyengit.github.io.`. They are not the preferred
  rollback path after root static cleanup.
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
   - `SMOKE_BASE_URL=https://skydeckla.com bun run test:smoke`
   - `SMOKE_BASE_URL=https://www.skydeckla.com bun run test:smoke`
4. Keep the previous known-good Vercel production deployment available for rollback.

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
11. Keep the prior Vercel production deployment available until the new one has served production cleanly for at least one DNS propagation window, preferably 24-48 hours.
12. Disable or alter legacy backend/payment surfaces only after explicit confirmation.

Required records if using third-party DNS:

- `A` record: `@` -> `216.198.79.1`
- `A` record: `@` -> `64.29.17.1`
- `CNAME` record: `www` -> `2c6615fa9eaccf36.vercel-dns-017.com.`

Remove the GitHub Pages apex A records when adding the Vercel A records. Preserve TXT, Brevo CNAME, and `pay` records.

## Hosting Rollback

Preferred rollback is Vercel rollback or promotion of the last known-good
deployment. Use DNS rollback only as an emergency manual path.

Historical GitHub Pages DNS values:

- Apex A records: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
- `www` CNAME: `junyengit.github.io.`

If emergency DNS rollback is used, verify HTTPS and redirects again after
propagation.

## Legacy Surface Shutdown

Root GitHub Pages static files are no longer the active rollback path after
cleanup. Do not disable Supabase functions/storage or payment webhooks during
the migration. Use them only until Convex, payment, admin, and POS replacements
are verified.

1. Keep the old DNS values recorded for incident response.
2. Confirm Vercel production is serving `skydeckla.com` and `www.skydeckla.com`.
3. Confirm smoke tests pass.
4. Confirm payment/order/admin/POS flows are migrated or intentionally disabled.
5. Confirm the previous Vercel deployment is available as hosting rollback.

## Verification

Check these before declaring cutover done:

- `https://skydeckla.com`
- `https://www.skydeckla.com`
- `/checkout` or its migrated replacement
- `/members` or its migrated replacement
- `/privacy`
- `/terms`
- Admin/POS routes return an intentional login or disabled state.
