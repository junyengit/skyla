# ADR 0020: Native Admin Booking Lookup

Date: 2026-07-02

## Status

Accepted.

## Context

Legacy `admin.html` has a front-desk check-in surface for scanning or typing a
booking reference. That screen also contains voucher redemption, deletes,
reset-all controls, and other localStorage/Supabase-era behavior that should not
be moved blindly into the native app.

Native `/admin` already has a staff-token operations snapshot, booking/member
status actions, and typed announcement/hours config. Staff still need a focused
front-desk way to look up one booking and check it in without relying on the
legacy page.

## Decision

Add a narrow native booking lookup slice:

- `/api/admin/bookings/lookup` requires a staff bearer token before checking
  Convex configuration.
- The route fails closed with `convex_unconfigured` until the real Convex URL is
  configured.
- The route forwards only a bounded query and limit to
  `admin.lookupBookingForCheckIn`.
- Convex lookup supports exact booking-reference lookup and bounded exact-email
  lookup through existing indexes.
- Native `/admin` renders a Booking Lookup panel that can check in or undo
  check-in through the existing audited booking status mutation.

## Non-Goals

- Voucher redemption.
- Refunds or payment reconciliation.
- Hard deletes, clear-all, reset-all, password changes, pricing/menu/catalog
  edits, reader setup, or live POS charging.
- Broad fuzzy search over the booking table before the data model and indexes
  justify it.

## Consequences

The front desk can move one more daily workflow to the native admin app once
Convex/staff envs are configured, while the risky legacy workflows remain
explicitly gated for later typed models and acceptance tests.
