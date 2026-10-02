# Authoritative visit capacity and private-event calendar, October 2, 2026

Implements the capacity half of [0035](0035-admission-policy-and-operations.md). Ticket sales remain off (`siteConfig.launched=false`); every purchase route and the Convex gateway stay locked, and the local preview flag still only renders `/checkout`.

## Rules

- `packages/payments/src/visitCalendar.ts` is the single America/Los_Angeles calendar. It reads the LA date and minute with `Intl` and an explicit time zone. It never uses the device zone, an implicit-local `Date.parse`, or a fixed offset, so UTC midnight and the November 1 DST change cannot move a ticket. Purchase-time rules: real date, not past, within the 365-day horizon, an offered entry time, inside configured hours, and not earlier than the current LA minute when the date is today. Hours keep their existing meaning, including all-day when open equals close. A missing or invalid hours row uses the documented `defaultHours`, never all-day booking. Overnight hours keep their same-date entries, but every entitlement ends at that date's midnight.
- Capacity is 30 people of any age inside at once. A party holds its places from its entry time through the closing of the segment it enters. No visit length is assumed. Only a recorded `departedAt` ends a span earlier; departures will be recorded by the future staff admission milestone. The forecast for an entry time is the peak occupancy from that time until closing.
- Visit drafts now require a date and entry time.

## Reservation records

`capacityReservations` has one row per order, indexed by order and by date+status:

- `draft`: created atomically with the order in `createCheckoutOrderDraft`. The hold counts every ticket line, including free children. An idempotent retry returns the same order and hold, and a changed body is rejected. Convex serializes conflicting mutations, so racing last-place requests cannot exceed 30. Draft expiry releases the hold.
- `payment_pending`: set by `orderDrafts.beginCheckoutPaymentAttempt` before the Stripe network call. It runs only after the credentials, return origins and stored snapshot have been checked. TTL never releases this hold. Only a signed Stripe `checkout.session.expired` or `async_payment_failed` event, correlated to the Convex-created session, releases it.
- `paid`: set in the same transaction as the paid booking. Stale or reordered unpaid events never reopen it. Refunds and booking cancellations do not release it either, because people may still be inside.
- `exception`: a paid order that had no usable hold and no room. No booking or ticket is issued. The webhook is recorded as `failed` with `paid_order_capacity_exception`, a `checkout.capacityException` audit event is written, and the party still counts so the venue cannot be oversold.

Occupancy reads are bounded and fail closed: any of the following marks a date `unverified`, which means no sales:

- an unknown party size or unknown booking status
- a committed booking with no date
- any imported legacy bookings (`legacyMigrationSources.bookingCount > 0`)
- hitting the 500-row read bound

Committed bookings without a reservation row (POS, earlier checkouts) count conservatively. Inquiries are leads and are never read.

## Private events and public reads

- `privateEvents` blocks a whole LA date. `privateEvents.createPrivateEvent` and `cancelPrivateEvent` are admin-only; `listPrivateEvents` is for admins and viewers. Creation is idempotent per key, rejects a changed body, a second confirmed event on the same date, or held/committed visitor places, and writes an immutable audit event. Cancellation keeps the record and its history. A cancelled event is never reactivated; a new event must pass the checks again. Native routes: `GET`/`POST /api/admin/private-events` and `POST /api/admin/private-events/cancel`. The staff calendar UI belongs to the operations milestone.
- `availability.getPublicVisitAvailability` and `GET /api/availability?date=&party=` are read-only, anonymous and aggregate: slot status and remaining places only. They stay readable while sales are off. The checkout reads them on each date or party change, ignores stale responses, keeps Review locked until a valid read arrives, rotates the idempotency key when a reviewed order changes, and refreshes when the server rejects a slot at review.

## Unfinished seams (not faked)

1. **Before sales activation:** reconcile imported legacy bookings, which currently mark every date unverified for both visit sales and private-event confirmation; then recover and import existing private-event dates through the admin API. Historical records need an audited reconciliation path in the operations milestone, not a blanket override of unknown capacity.
2. **Payment milestone:**
   - Stripe session TTL (`expires_at`) is not set.
   - A failed or unknown session creation leaves a `payment_pending` hold until the date passes; reconciliation is not built.
   - `exception` rows need billing/refund handling.
   - A paid webhook after closing still fulfills until the LA date ends. After the date, it fails as before.
3. **Staff admission milestone:** redemption, recorded departures, release rules for authorized cancellation, and POS capacity holds.
4. **Copy:** the 30-minute arrival wording in `apps/web/app/terms/page.tsx` and the legal drafts conflicts with same-day late entry and is left for the admission change.
5. **Superseded drafts:** a draft the guest abandons by changing their order keeps its places until its 30-minute expiry.
