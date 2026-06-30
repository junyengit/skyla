# Sky LA Convex Backend

This directory is the target Convex backend for the migration away from the
legacy Supabase/browser data bridge.

The committed artifacts now include:

- `schema.ts`: canonical tables for catalog data, checkout orders, POS sales,
  line items, payment/webhook ledgers, promoted legacy records, staff users,
  config, and audit events.
- `orderDrafts.ts`: public Convex mutations/queries for persisted checkout
  order drafts and staff-gated POS sale drafts.
- `payments.ts`: public Convex action for creating Stripe Checkout Sessions
  from stored checkout `orderRef` records only.
- `paymentInternals.ts`: internal order snapshot and payment-event ledger
  functions used by payment actions.
- `lib/`: shared auth and draft-persistence helpers.
- `_generated/`: generated Convex API/server/data-model types from local
  anonymous Convex validation.

Local validation that does not require a linked Convex deployment:

```bash
bun run convex:schema:typecheck
bun run convex:functions:typecheck
bun run convex:test:unit
```

Local anonymous Convex validation used while no cloud deployment is linked:

```bash
CONVEX_AGENT_MODE=anonymous bunx convex dev --once --typecheck enable
```

Deployment-linked validation after the real project is configured:

```bash
bun run convex:codegen
```

No production checkout/POS traffic is cut over by this directory yet. The
Stripe Checkout action exists, but the public compatibility checkout still uses
the legacy bridge until real Convex/Stripe envs and webhooks are verified. The
next backend slices should:

1. Create or link the real Convex deployment.
2. Add webhook HTTP actions with idempotency and expected amount checks.
3. Add Kaskade and Terminal provider actions that accept only `orderRef` or
   `saleRef`, never browser totals.
4. Move the Next checkout/POS flows from compatibility pages to persisted
   Convex draft refs.
