# Skyla Migration Progress

This file is the durable scratchpad for the migration. Update it whenever a task starts, finishes, or is deferred.

## Active Goal

Build and validate the Vercel/Turborepo/Next.js foundation for Skyla, document the migration path, preserve the legacy static site until cutover, and prepare the next phases for Convex, payments, admin/POS, domains, and old deployment shutdown.

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

## In Progress

- [ ] Deploy or prepare Vercel project setup.
- [ ] Review major work for accuracy.

## Deferred Until Foundation Is Stable

- [ ] Convex implementation.
- [ ] Stripe/Kaskade server-authoritative order flow.
- [ ] Admin/POS rebuild.
- [ ] Vercel production domain cutover.
- [ ] Disable old GitHub Pages deployment.
- [ ] Disable old Supabase functions/storage after migration.

## Decisions

- Keep legacy static files at repo root until Vercel app has parity and production cutover is complete.
- Use `apps/web` as the Vercel project root.
- Do not commit or deploy `output/` or `tmp/`.
- Do not disable GitHub Pages until Vercel production is verified and the user confirms the action.

## Risks To Track

- Current local working tree includes unrelated pre-existing content edits. Do not revert them.
- Old root static pages and new Next app coexist temporarily.
- Vercel/domain setup may require browser login or user confirmation before cloud-side changes.
- Payment/auth/data migration must not be done as a cosmetic rewrite; server authority is the main security requirement.
