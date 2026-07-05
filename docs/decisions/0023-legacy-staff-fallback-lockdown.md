# Decision 0023: Lock Legacy Staff Fallback Writes

## Status

Accepted.

## Context

Native `/admin` and `/pos` now own the active staff migration path. They route
through Next.js API handlers and Convex staff-authenticated functions, and the
payment routes accept stored refs instead of browser totals.

The explicit `.html` fallbacks still exist for migration continuity, but they
load old browser code that was originally allowed to mutate bookings, vouchers,
catalog data, hours, announcements, member applications, local passwords, and
Stripe Terminal reader setup through Supabase/localStorage.

## Decision

Keep the fallback pages reachable and noindexed for now, but make them
read-only or disabled for operational writes:

- `/admin.html` may display/export old data, but legacy write handlers are
  blocked by `LEGACY_ADMIN_MUTATIONS_ENABLED = false`.
- `/pos.html` may display the old register shell, but legacy Terminal payments
  and reader setup are blocked by explicit false latches.
- The repo copy of `supabase/functions/stripe-terminal` returns `410` for all
  old bridge actions, including `setup-reader`.
- Convex Terminal reader processing checks `SKYLA_POS_TERMINAL_ACCEPTANCE`
  directly, matching the create-intent action rather than trusting only the
  Next.js route guard.

## Why

This shrinks the live legacy attack surface without pretending the native staff
rebuild is complete. Daily staff workflows should move forward through typed
Convex models, audit events, and rollback steps instead of reviving old browser
mutation paths.

## Follow-Up

- Build native voucher redemption.
- Replace free-text POS reader entry with a staff-gated registry selector.
- Finish native catalog/pricing, refunds, deletes, and reset workflows with
  typed validators.
- Disable or delete deployed Supabase functions after Convex and Stripe
  dashboard acceptance passes.
