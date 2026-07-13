# Security Policy

## Reporting

Report suspected Skyla security issues privately to `reservations@skydeckla.com` until a dedicated security mailbox is configured.

Do not open public issues for vulnerabilities involving payments, staff access, booking data, customer data, secrets, or provider webhooks.

## Current Risks

Checkout and POS totals are now server-authoritative, the old browser staff apps
are no longer shipped, and the repo copies of legacy payment functions are
permanently fail-closed. The remaining risks are operational and acceptance
gaps:

- Convex, Clerk, Vercel, and Stripe dashboards are not yet linked and accepted
  end to end. Missing or mismatched configuration must continue to fail closed.
- Vercel Preview must use the Convex development URL and Production must use the
  separate Convex production URL. Cross-environment bindings could write to the
  wrong deployment.
- Stripe keys, webhook secrets, staff bootstrap tokens, migration tokens, and
  Terminal reader registries must remain out of Vercel and browser-readable
  variables. The temporary `SKYLA_POS_TERMINAL_ACCEPTANCE` latch is allowed in
  one selected Vercel runtime and its matching Convex deployment only during a
  controlled acceptance window.
- Clerk authenticates human staff, but Convex `staffUsers` and
  `requireStaffUser` remain authorization authority. A valid Clerk account must
  not grant a role by itself, and bootstrap tokens must be removed after use.
- Any Supabase-era payment/webhook functions still deployed in the provider
  dashboard must be disabled or redeployed from the guarded HTTP-410 stubs.
- Linked Stripe Checkout, Terminal, refund, and replay acceptance has not run;
  real cards remain prohibited during migration verification.
- Legacy data migration handles customer PII. Immutable exports, quarantine,
  manifests, and migration artifacts must stay under ignored paths such as
  `.migration/`, `output/`, and `tmp/`, with the temporary token removed after
  each migration window.

Kaskade/PharosGate is not part of the active architecture. There is no current
Kaskade implementation or key to configure; its only remaining security scope
is proving that any deployed legacy endpoints are disabled or serve the repo's
retired `410` behavior.

## Baseline Checks

Run before merging security-sensitive changes:

```bash
PATH="$HOME/.bun/bin:$PATH" bun run check
PATH="$HOME/.bun/bin:$PATH" bun run security:artifacts
PATH="$HOME/.bun/bin:$PATH" bun run security:audit
```

Run route smoke checks after deployments:

```bash
PATH="$HOME/.bun/bin:$PATH" SMOKE_BASE_URL=https://skydeckla.com bun run test:smoke
PATH="$HOME/.bun/bin:$PATH" SMOKE_BASE_URL=https://www.skydeckla.com bun run test:smoke
```
