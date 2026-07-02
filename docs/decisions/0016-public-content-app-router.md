# Decision 0016: Public Content App Router Cutover

## Status

Accepted for the public content migration.

## Context

The route bridge kept `/about` and `/cafe` on static compatibility HTML pages.
Those pages loaded the legacy `shared-data.js` browser localStorage/Supabase
bridge even though they do not need public writes. The cafe page also displayed
menu prices from static markup while the newer checkout/POS code owns catalog
prices in `@skyla/payments`.

## Decision

Move `/about` and `/cafe` to native Next.js App Router pages and keep
`/about.html` and `/cafe.html` as compatibility URLs. Remove `shared-data.js`
from the compatibility copies for these content-only pages.

The native `/cafe` page reads active cafe items from `@skyla/payments` so the
public menu shares the same server-owned catalog source as POS and checkout.

## Consequences

- Public content pages ship as static Server Components with no legacy
  localStorage/Supabase bridge.
- Old `.html` links continue to return `200`.
- `/experiences` remains on the legacy bridge because it still has lead-form and
  ad-conversion behavior that needs a dedicated Convex/analytics migration.
