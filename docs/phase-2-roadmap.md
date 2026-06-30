# Skyla Phase 2 Roadmap

Last updated: 2026-06-30

## Plain-English Goal

Skyla is moving from a flat static site with browser-heavy business logic into a maintainable product app:

- Vercel serves the production domain.
- Next.js owns public pages, checkout, admin, and POS.
- Convex becomes the canonical database and server logic layer.
- Stripe, Kaskade, email, admin, and POS actions become server-authoritative.
- Legacy static files are kept only as app-owned compatibility pages under `apps/web/public`.
- Bun canary is adopted deliberately across local development, CI, and Vercel builds.

The work should move in small PRs. Each PR should leave the site deployable, testable, and reversible.

## Current Shape

```mermaid
flowchart LR
  visitor["Visitor / Staff"]
  domain["skydeckla.com"]
  vercel["Vercel project: junyen-enterprises/web"]
  next["apps/web Next.js App Router"]
  bridge["apps/web/public legacy bridge"]
  supabase["Supabase auth, tables, edge functions"]
  payments["Stripe / Kaskade / EmailJS / Brevo"]

  visitor --> domain
  domain --> vercel
  vercel --> next
  next --> bridge
  bridge --> supabase
  bridge --> payments
```

Why this is okay short term:

- It prevents broken public URLs during DNS cutover.
- It gives us a safe place to rebuild route-by-route instead of doing one risky rewrite.
- Hosting rollback can use previous Vercel deployments.

Why this is not the final state:

- Checkout and paid booking creation are still too browser-controlled.
- Admin and POS rely heavily on client-side behavior.
- Supabase-era functions and data access are still outside the target architecture.
- Compatibility files in `apps/web/public` are still legacy code and should be replaced with typed routes.

## Target Shape

```mermaid
flowchart TB
  subgraph vercel["Vercel"]
    web["apps/web Next.js"]
    routes["Public, checkout, members, admin, POS routes"]
  end

  subgraph convex["Convex"]
    schema["Typed schema"]
    queries["Queries"]
    mutations["Mutations"]
    actions["Actions / HTTP actions"]
    ledgers["Order, payment, webhook ledgers"]
  end

  subgraph providers["External providers"]
    stripe["Stripe"]
    kaskade["Kaskade / PharosGate"]
    email["Brevo / email"]
  end

  web --> routes
  routes --> queries
  routes --> mutations
  routes --> actions
  actions --> stripe
  actions --> kaskade
  actions --> email
  actions --> ledgers
```

Why this is better:

- Server code calculates money, roles, and state transitions.
- Webhooks become idempotent and auditable.
- Staff actions can be authorized and logged consistently.
- Tests can target real business boundaries instead of browser globals.
- The repo structure tells future contributors where things live.

## Target Repository Layout

```text
skyla/
  apps/
    web/
      app/
        (public)/
        checkout/
        members/
        admin/
        pos/
        api/ or route handlers where needed
      components/
      lib/
      public/
        images/
  packages/
    config/
    ui/
    data/              # shared types/contracts for Convex-facing data
    payments/          # shared order/payment contract helpers
    testing/           # optional shared test utilities
  convex/
    schema.ts
    bookings.ts
    members.ts
    orders.ts
    payments.ts
    webhooks.ts
    staff.ts
    http.ts
  docs/
    phase-2-roadmap.md
    migration-plan.md
    migration-progress.md
    architecture.md
    environment.md
    decisions/
    runbooks/
  scripts/
    migrations/
    audits/
    setup/
```

## Workstreams

Supporting detail:

- Raw discovery findings: [audits/phase-2-discovery.md](audits/phase-2-discovery.md)
- Bun decision record: [decisions/0001-bun-canary-evaluation.md](decisions/0001-bun-canary-evaluation.md)
- Legacy cleanup decision record: [decisions/0002-legacy-static-cleanup.md](decisions/0002-legacy-static-cleanup.md)

### 1. Repository Cleanup

Move the repo from "static site plus new app" to "new app with explicit compatibility bridges."

Initial actions:

- Remove root legacy duplicates after Vercel custom-domain cutover is verified.
- Keep `apps/web/public` compatibility files until their App Router replacements are live.
- Deduplicate images so canonical assets live under `apps/web/public/images`.
- Keep `output/`, `tmp/`, generated PDFs, logs, local env files, and generated CSVs ignored.

Definition of done:

- Root contains project-level files only.
- Public URLs are served by App Router routes or intentional compatibility redirects.
- Legacy source remains discoverable, but not mixed with active app entrypoints.

### 2. Bun Adoption

Bun should be adopted deliberately, not by half-switching lockfiles.

Initial actions:

- Install/upgrade canary locally with Bun's canary command: `bun upgrade --canary`.
- Generate a text `bun.lock`, not binary-only `bun.lockb`, because Turborepo needs text lockfile analysis.
- Replace `pnpm-lock.yaml` only after Bun install/build/test passes locally and in CI.
- Configure Vercel with Bun-compatible install/build commands and `bunVersion` where supported.
- Keep Node `24.x` documented while Next/Vercel function runtime behavior is validated.
- Track Turbo's warning about Bun canary lockfile version 2 until that integration is resolved.

Definition of done:

- CI installs with Bun.
- Vercel production deploys with the same package-manager behavior as CI.
- `bun run check` covers lint, typecheck, build, and tests.
- Rollback to pnpm is documented until Bun canary proves stable.

### 3. Convex Migration

Convex should own canonical data and business state.

Initial tables:

- `bookings`
- `members`
- `inquiries`
- `config`
- `orders`
- `orderLineItems`
- `posSales`
- `posSaleLines`
- `paymentEvents`
- `webhookEvents`
- `products`
- `staffUsers`
- `auditEvents`

Initial server boundaries:

- Public inquiry/member submissions: Convex mutations.
- Checkout/order creation: Convex mutation creates an order with canonical prices.
- Stripe/Kaskade payment creation: Convex action uses stored order state.
- Webhooks: Convex HTTP actions verify signatures, enforce expected amount/currency/status, and write idempotent events.
- Admin/POS: Convex queries/mutations enforce staff roles server-side.

Definition of done:

- Supabase reads/writes are replaced route-by-route.
- Dual-run migration has reconciled counts and sampled data.
- Supabase functions are disabled only after verification and explicit rollback decision.

### 4. Product Functionality Rebuild

Rebuild the compatibility bridge into real Next routes.

Priority order:

1. Legal and content pages: `/privacy`, `/terms`, `/about`, `/cafe`, `/experiences`.
2. Members flow: `/members`.
3. Checkout flow: `/checkout`.
4. Admin gate and dashboard: `/admin`.
5. POS flow: `/pos`.

Definition of done:

- Each route has a typed App Router implementation.
- Legacy `.html` paths redirect or rewrite intentionally.
- Reduced-motion and mobile layouts are verified.
- Admin/POS are `noindex` and authenticated.

### 5. QA, Security, And GitHub Hardening

Add safety rails before removing the old deployment surfaces.

Initial actions:

- Add route/header smoke tests for production and previews.
- Add checkout/order unit tests around canonical pricing.
- Add webhook idempotency tests.
- Add admin/POS authorization tests.
- Add dependency and secret scanning workflows.
- Protect `main`, require PRs, and require CI.
- Track and fix current bridge risks: client-authoritative payment creation, local admin password fallback, stored-XSS surfaces, legacy POS Terminal charge authority, and POS/admin date-format drift. POS reader setup is temporarily bridged, but it still belongs in the future staff-authorized backend.

Definition of done:

- PRs cannot merge without checks.
- Production deploys have a repeatable smoke-test checklist.
- Security findings are tracked and fixed or explicitly accepted.

Baseline now in place:

- `bun run test:unit` covers shared pricing/contact constants and the temporary legacy-route bridge.
- `@skyla/payments` now covers canonical checkout and POS draft calculations; browser-supplied totals are ignored by contract tests.
- `bun run convex:schema:typecheck` checks `convex/schema.ts` without requiring a linked Convex deployment.
- `bun run security:artifacts` blocks tracked generated artifacts, local env files, obvious provider keys, and private keys.
- `bun run security:audit` fails on high or critical dependency advisories across production and dev tooling.
- `bun run test:smoke` checks the route matrix and admin/POS `X-Robots-Tag` headers against a supplied deployment URL.
- Dependabot, CodeQL, CODEOWNERS, and `SECURITY.md` are present in repo config; GitHub dashboard protection remains a separate verification step.

## PR Ladder

1. Roadmap and tracker docs.
2. QA/security baseline branch.
3. Bun canary and root cleanup branch.
4. App/public compatibility cleanup after App Router replacements.
5. App Router content routes.
6. Convex scaffold and schema.
7. Server-authoritative order/payment boundary.
8. Members flow.
9. Admin/POS rebuild.
10. Supabase shutdown after Convex/payment verification.
11. Compatibility bridge removal route-by-route.

## Raw Operational Data For Agents

Current verified Vercel data:

- Team: `Junyen Enterprises`
- Team ID: `team_3kWPO8fPD6E7x39voGoNNeog`
- Project: `web`
- Project ID: `prj_fhlOjcwSbnPAuLi8tTiGbhjVomnr`
- Vercel project root: `apps/web`
- Production branch: `main`
- Latest verified application production commit: `b1272b9112dbde4c83c74b07c8d6204ee98c2960`
- Latest verified application production deployment: `https://web-d1efck3u8-junyen-enterprises.vercel.app`
- Latest verified application production deployment ID: `dpl_FNnfuoY5KbLKG7WceuXuhycp8Q2r`
- Domains attached and Vercel-verified: `skydeckla.com`, `www.skydeckla.com`
- Nameservers: `ns1.vercel-dns.com`, `ns2.vercel-dns.com`

Current order-spine state:

- Merged foundation PR: `#13`
- Active persisted-draft branch: `codex/convex-persist-order-drafts`
- Existing artifacts: `convex/schema.ts`, `convex/orderDrafts.ts`, `convex/lib/*`, `convex/_generated/*`, `packages/payments`, `/api/order-drafts/checkout`
- Convex package: `convex@1.42.1`
- Persisted draft refs: checkout `SKYYYMM-XXXXXX`; POS `SALEYYMMDD-XXXXXX`
- Local Convex validation: anonymous local deployment at `http://127.0.0.1:3210` when `CONVEX_AGENT_MODE=anonymous bunx convex dev --once --typecheck enable` is run
- Not present yet: `convex.json`, linked cloud deployment, Vercel Convex env vars, provider actions, HTTP webhooks, live checkout cutover
- Live compatibility checkout still uses `apps/web/public/checkout.html` and legacy Supabase/payment bridges.
- Local no-deployment Convex gate: `bun run convex:schema:typecheck`
- Convex helper gates: `bun run convex:test:unit`, `bun run convex:functions:typecheck`
- Deployment-linked Convex gate after project linking: `bun run convex:codegen`

Current package baseline:

- Next.js `16.2.9`
- React `19.2.7`
- Motion `12.42.0`
- Turborepo `2.10.1`
- TypeScript `6.0.3`
- Package manager: Bun canary with text `bun.lock`
- Last verified Bun revision: `1.4.0-canary.1+ffea69ae7`

Useful verification commands:

```bash
PATH="$HOME/.bun/bin:$PATH" bun run check
PATH="$HOME/.bun/bin:$PATH" bun run convex:schema:typecheck
PATH="$HOME/.bun/bin:$PATH" bun run convex:test:unit
PATH="$HOME/.bun/bin:$PATH" bun run convex:functions:typecheck
PATH="$HOME/.bun/bin:$PATH" CONVEX_AGENT_MODE=anonymous bunx convex dev --once --typecheck enable
dig +short skydeckla.com NS
dig +short skydeckla.com A
dig +short www.skydeckla.com A
curl -I https://skydeckla.com
curl -I https://www.skydeckla.com
```

Vercel CLI in this environment:

```bash
PATH="$HOME/.bun/bin:$PATH"
bunx vercel ls web --scope junyen-enterprises
```

## Active Risks

- Bun canary can introduce instability; keep the pnpm rollback path documented
  until a Vercel preview and production deployment prove the branch.
- Local DNS/browser caches can lag a nameserver cutover; the current apex and `www` smoke tests now pass without overrides.
- Root legacy files have been removed after Vercel cutover verification.
- Compatibility pages in `apps/web/public` remain until App Router replacements are tested.
- Client-side payment/admin logic must not be treated as secure just because it is now served from Vercel.
- Convex migration should be dual-run and reconciled before Supabase shutdown.
