# Sky LA Convex Backend

This directory is the target Convex backend for the migration away from the
legacy Supabase/browser data bridge.

The committed artifacts now include:

- `schema.ts`: canonical tables for catalog data, checkout orders, POS sales,
  line items, payment/webhook ledgers, promoted legacy records, staff users,
  config, and audit events.
- `orderDrafts.ts`: public Convex mutations/queries for persisted checkout
  order drafts and staff-gated POS sale drafts.
- `payments.ts`: public Convex actions for creating Stripe Checkout Sessions
  from stored checkout `orderRef` records only and Stripe Terminal
  PaymentIntents from stored POS `saleRef` records only.
- `paymentInternals.ts`: internal order snapshot and payment-event ledger
  functions used by payment actions.
- `http.ts`: HTTP route for Stripe Checkout and Terminal webhooks at
  `POST /stripe-webhook`.
- `staffBootstrap.ts`: temporary token-gated mutation for seeding initial
  `staffUsers` rows after the real Convex project is linked.
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

No production checkout/POS payment traffic is cut over yet. The Stripe Checkout
action, Terminal sale-ref action, reader-processing action, Checkout webhook
reconciliation, and Terminal PaymentIntent webhook reconciliation exist, but
they stay gated until real Convex/Stripe envs, staff auth, Stripe dashboard
webhook setup, and preview acceptance are verified. The next backend slices
should:

1. Create or link the real Convex deployment.
2. Seed staff through `staffBootstrap.upsertStaffUser`, then remove
   `SKYLA_STAFF_BOOTSTRAP_TOKEN`.
3. Add Kaskade provider actions that accept only `orderRef`, never browser
   totals.
4. Accept checkout/POS flows against persisted Convex draft refs with real
   Vercel/Convex/Stripe envs.
