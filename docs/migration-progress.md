# Skyla Migration Progress

This file is the durable scratchpad for the migration. Update it whenever a task starts, finishes, or is deferred.

## Active Goal

Finish the Vercel/Turborepo/Next.js foundation, keep the legacy static site recoverable, make the Vercel production deployment route-compatible with current public paths, then cut over `skydeckla.com` only after verification.

## Current Status

- [x] Verified current production is GitHub Pages from `main` root.
- [x] Verified latest package baseline through npm registry:
  - Next.js `16.2.9`
  - React `19.2.7`
  - Motion `12.42.0`
  - Turbo `2.10.1`
  - TypeScript `6.0.3`
- [x] Added `.gitignore` protection for generated/private artifacts.
- [x] Added root Turborepo workspace files.
- [x] Added `apps/web` Next.js scaffold.
- [x] Added `packages/config` and `packages/ui`.
- [x] Copied images into `apps/web/public/images`.
- [x] Added initial CI workflow.
- [x] Wrote comprehensive migration plan.
- [x] Added README and runbooks.
- [x] Installed dependencies and generated `pnpm-lock.yaml`.
- [x] Fixed build/type/lint issues.
- [x] Ran `pnpm check`: lint, typecheck, shared package builds, and Next.js production build all passed.
- [x] Incorporated Vercel/domain research into runbooks.
- [x] Opened the local Next app in Helium at `http://127.0.0.1:3000`; dev server returned `GET / 200`.
- [x] Reviewed subagent findings and fixed clean-checkout package exports, Node pinning, TypeScript artifact ignores, Vercel command clarity, GitHub Pages merge risk, and Turbo task ordering.
- [x] Created Vercel project `junyen-enterprises/web` for `apps/web` with project ID `prj_fhlOjcwSbnPAuLi8tTiGbhjVomnr`.
- [x] Deployed first Vercel build: `https://web-fwlmziond-junyen-enterprises.vercel.app` (`dpl_DE5YnDKHuuZ4rNcFewuCLYWAeCjH`, READY).
- [x] Opened the Vercel deployment in Helium; homepage rendered successfully.
- [x] Verified clean Git-triggered Vercel deployment: `https://web-h6lacs7d4-junyen-enterprises.vercel.app` (`dpl_4qMAwUAUTPhpmEGmbfW2bfBHFJzu`, READY, branch `codex/next-vercel-turbo-migration`, commit `cbd9b80`).
- [x] Fixed PR review issue in `apps/web/next-env.d.ts` and reran `pnpm check`.
- [x] Merged PR #1 into `main` with merge commit `950ae150ec897afd5457b79ce61c5529142a1edb`.
- [x] Confirmed GitHub CI passed on `main`.
- [x] Confirmed Vercel production deployment from `main` is READY: `https://web-qft9c4zja-junyen-enterprises.vercel.app` (`dpl_5W8dTG9onDxvW8CUwSptKyG3SqFj`).
- [x] Added `skydeckla.com` and `www.skydeckla.com` to the Vercel project.
- [x] Confirmed GoDaddy DNS is still on GitHub Pages and canceled an unsaved DNS edit before route readiness.
- [x] Added Vercel compatibility coverage for legacy public routes and `.html` files in `apps/web/public`.
- [x] Merged route-compatibility PR #2 into `main` with merge commit `f3c99649ea87a9b94e40bdc3e7de35f1ea98e923`.
- [x] Confirmed GitHub CI passed on `main` for `f3c99649ea87a9b94e40bdc3e7de35f1ea98e923`.
- [x] Confirmed Vercel production deployment from `main` is READY: `https://web-istczvmf1-junyen-enterprises.vercel.app` (`dpl_FBG27TbZxzTzfQKgTy4LWaxKF35L`).
- [x] Verified Vercel production route matrix on `https://web-istczvmf1-junyen-enterprises.vercel.app`: `/`, `/index.html`, `/about`, `/about.html`, `/cafe`, `/cafe.html`, `/experiences`, `/experiences.html`, `/checkout`, `/checkout.html`, `/members`, `/members.html`, `/privacy`, `/privacy.html`, `/terms`, `/terms.html`, `/admin`, `/admin.html`, `/pos`, `/pos.html`, `/robots.txt`, and `/sitemap.xml` returned `200`.
- [x] Verified `/admin`, `/admin.html`, `/pos`, and `/pos.html` include `X-Robots-Tag: noindex, nofollow` on the Vercel production URL.
- [x] Confirmed Vercel production URL is publicly reachable without Vercel Authentication.
- [x] Pushed current-state documentation commit `d8da1e3c8ac653f6143aa456debec84069b0ea60` to `main`; GitHub CI and Pages workflow passed.
- [x] Confirmed Vercel production deployment from `main` is READY: `https://web-hc38hldhg-junyen-enterprises.vercel.app` (`dpl_3Q8VU3XvtK4DiiHbkJ9x8p21Wjb5`).
- [x] Confirmed `skydeckla.com` nameservers now resolve to `ns1.vercel-dns.com` and `ns2.vercel-dns.com`.
- [x] Confirmed Vercel domain verification returns `configured_correctly` for both `skydeckla.com` and `www.skydeckla.com`.
- [x] Confirmed direct Vercel-edge requests for `https://skydeckla.com/`, `https://skydeckla.com/checkout`, `https://www.skydeckla.com/`, and `https://www.skydeckla.com/checkout` return `200`.

## In Progress

- [ ] Re-run custom-domain smoke tests without DNS overrides after local OS/browser DNS caches stop returning stale GitHub Pages answers.

## Deferred Until Foundation Is Stable

- [ ] Convex implementation.
- [ ] Stripe/Kaskade server-authoritative order flow.
- [ ] Admin/POS rebuild.
- [ ] Disable old GitHub Pages deployment.
- [ ] Disable old Supabase functions/storage after migration.

## Decisions

- Keep legacy static files at repo root until Vercel app has parity and production cutover is complete.
- Use `apps/web` as the Vercel project root.
- Bridge legacy routes from Vercel to static compatibility files during cutover. This is a temporary reliability measure, not the final application architecture.
- Do not commit or deploy `output/` or `tmp/`.
- Do not disable GitHub Pages until Vercel production is verified and the user confirms the action.

## Risks To Track

- Current local working tree includes unrelated pre-existing content edits. Do not revert them.
- The first Vercel CLI deployment was built from a dirty local worktree because legacy root files are modified locally. Use a clean Git-triggered deployment as the cutover candidate.
- Old root static pages and new Next app coexist temporarily.
- The GitHub Pages project URL redirects through the repository `CNAME`, so it is not a clean fallback after DNS cutover unless the Pages custom-domain setup changes.
- Vercel/domain setup may require browser login or user confirmation before cloud-side changes.
- Immediately after the nameserver cutover, this Mac's system resolver still returned stale GitHub Pages behavior even while authoritative/external DNS and Vercel verification were correct. Treat any GitHub Pages response as DNS/cache propagation until confirmed otherwise.
- Payment/auth/data migration must not be done as a cosmetic rewrite; server authority is the main security requirement.
