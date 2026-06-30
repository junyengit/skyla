# Sky LA Convex Backend

This directory is the target Convex backend for the migration away from the
legacy Supabase/browser data bridge.

The first committed artifact is `schema.ts`. It defines the canonical tables
for catalog data, checkout orders, POS sales, line items, payment/webhook
ledgers, promoted legacy bookings, staff users, and audit events.

Local validation that does not require a linked Convex deployment:

```bash
bun run convex:schema:typecheck
```

Deployment-linked validation after the real project is configured:

```bash
bun run convex:codegen
```

No production traffic is cut over by this directory yet. The next backend
slices should:

1. Create or link the real Convex deployment.
2. Run Convex codegen and commit generated API/server types.
3. Add mutations that persist order drafts from `@skyla/payments`.
4. Add provider actions that accept only `orderRef` or `saleRef`, never browser
   totals.
5. Add webhook HTTP actions with idempotency and expected amount checks.
