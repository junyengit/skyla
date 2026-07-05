# Decision 0024: Native Admin Voucher Redemption Ledger

## Status

Accepted.

## Context

Legacy `/admin.html` could redeem package inclusions and add-on vouchers by
mutating booking-local browser data. That fallback is now read/export-only, so
staff needed a native replacement on `/admin` that fits the Convex migration.

Voucher redemption is not a payment capture. It is an operations record that
staff need during check-in, and it must not trust browser-provided voucher
quantities or legacy localStorage state.

## Decision

Native `/admin` voucher redemption uses a Convex event ledger:

- entitlement quantities are computed server-side from stored order line items
  when a booking has an `orderRef`;
- legacy imported booking data is read only as a fallback for historical rows
  that do not have native order lines yet;
- each redeem or undo writes one `voucherRedemptionEvents` row;
- each redeem or undo also writes an `auditEvents` row with compact flat
  metadata;
- the browser sends only `bookingRef`, `voucherId`, `action`, optional note, and
  staff bearer auth;
- cancelled bookings are blocked, and linked native orders must be `paid`
  before voucher redemption is accepted.

## Why

An event ledger is easier to audit than mutating a counter on the booking. It
also gives operations a reversible check-in workflow without reviving the old
browser-authoritative admin writes.

## Follow-Up

- Link the real Convex deployment and verify redemption against seeded staff and
  paid test bookings.
- Decide whether historical legacy redemption counts should be imported into
  `voucherRedemptionEvents` or kept as read-only `rawLegacy` baselines.
- Keep refunds, catalog/pricing edits, hard deletes, and reset-all workflows
  gated until they have typed models, reconciliation rules, audit events, and
  rollback steps.
