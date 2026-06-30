# Domain Cutover Runbook

## Goal

Move `skydeckla.com` and `www.skydeckla.com` from GitHub Pages to Vercel with a clean rollback path.

## Current DNS Snapshot

- Registrar/DNS host: GoDaddy nameservers `ns77.domaincontrol.com` and `ns78.domaincontrol.com`.
- Apex `skydeckla.com`: GitHub Pages A records `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, and `185.199.111.153`.
- `www.skydeckla.com`: CNAME `junyengit.github.io.`
- Existing TXT records include `apple-domain-verification=UKchr7KlrHJiCids` and `brevo-code:bf64ac1498536c7d801c996cabb36ea8`. Preserve TXT records during cutover.
- No AAAA records were observed. Do not add AAAA records for Vercel.

Reconfirm this snapshot immediately before DNS changes.

## Vercel Domain State

As of June 30, 2026, both `skydeckla.com` and `www.skydeckla.com` have been added to Vercel project `junyen-enterprises/web`, but verification is pending DNS changes.

Vercel reported these DNS targets for this project:

- Apex A records: `216.198.79.1` and `64.29.17.1`
- `www` CNAME: `2c6615fa9eaccf36.vercel-dns-017.com.`

Verify these values in Vercel immediately before editing GoDaddy. If Vercel shows different records, use the current Vercel values.

## Cutover Preconditions

- Vercel production deployment is READY from `main`.
- The route matrix passes on the Vercel production URL:
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
- `/admin` and `/pos` include `X-Robots-Tag: noindex, nofollow`.
- Payment and booking flows are either verified or intentionally operating in the documented legacy bridge mode.

## Cutover Sequence

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

## GitHub Pages Shutdown

Do not disable GitHub Pages during cutover. Use it as rollback until Vercel production is proven.

1. Keep the old DNS values recorded.
2. After Vercel is verified, open GitHub repository Settings > Pages.
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

## Legacy Record Restore

Rollback to GitHub Pages by restoring:

- Apex A records: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
- `www` CNAME: `junyengit.github.io.`

Then verify HTTPS and redirects again after propagation.
