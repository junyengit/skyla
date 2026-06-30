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

## In Progress

- [ ] Deploy the route-compatibility follow-up to Vercel production.
- [ ] Verify Vercel production paths: `/`, `/about`, `/cafe`, `/experiences`, `/checkout`, `/members`, `/privacy`, `/terms`, `/admin`, `/pos`, `/robots.txt`, and `/sitemap.xml`.
- [ ] Cut GoDaddy DNS to Vercel only after the path matrix passes.

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
- Payment/auth/data migration must not be done as a cosmetic rewrite; server authority is the main security requirement.
