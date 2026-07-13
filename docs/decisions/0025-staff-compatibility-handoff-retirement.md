# Decision 0025: Retire Staff Compatibility Apps To Handoffs

## Status

Superseded by [Decision 0029](./0029-app-router-compatibility-redirects.md).

## Context

Native `/admin` and `/pos` now cover the active staff migration path through
Next.js routes, Next API handlers, Convex staff authorization, and
server-owned payment/order references. The remaining `/admin.html` and
`/pos.html` compatibility files still loaded the old localStorage/Supabase
browser apps even though writes and Terminal actions were latched off.

## Decision

Keep `/admin.html` and `/pos.html` as noindex compatibility URLs, but make them
self-contained handoff pages to `/admin` and `/pos`.

Remove the old staff browser assets from `apps/web/public`:

- `shared-data.js`
- `admin.js`
- `admin.css`
- `pos.js`
- `pos.css`

Production readiness now checks that the compatibility pages preserve
query/hash handoff behavior and that those retired assets are not served.

## Why

This removes the largest remaining browser-localStorage/Supabase staff surface
from the active public bundle while keeping saved staff bookmarks from breaking.
Future admin/POS work must land in the native App Router and Convex paths
instead of reactivating the old browser apps.

## Follow-Up

- Link real Convex and Stripe dashboard envs.
- Add a staff-gated POS reader registry selector.
- Complete linked acceptance for shipped read-only refund reconciliation, then
  finish catalog/pricing, any separately approved refund initiation, deletes,
  and reset workflows with typed validators, audit events, and rollback steps.
- Disable or delete deployed Supabase functions after Convex and Stripe
  dashboard acceptance passes.
