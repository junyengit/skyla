# Payment reconciliation, ticket delivery recovery and billing exceptions, October 2, 2026

Implements the payment items left open in [0036](0036-authoritative-visit-capacity.md), under the policy in [0035](0035-admission-policy-and-operations.md). Ticket sales stay off (`siteConfig.launched=false`). Every sale-creating route, the new draft-release route and the Convex gateway operations stay locked. The local preview flag still only renders `/checkout`. No real Stripe/Resend provider was called and no email, refund or production credential changed. Unit tests use provider fakes; independent acceptance also used the actual isolated anonymous Convex database and HTTP webhook endpoint with signed synthetic Stripe events. This does not prove an actual Stripe test payment, Clerk JWT or inbox receipt.

## One frozen attempt per order

`checkoutPaymentAttempts` (`convex/checkoutReconciliation.ts`, `convex/lib/checkoutAttempts.ts`):

- **What is frozen.** `openCheckoutSessionAttempt` stores the exact Stripe form parameters in the same transaction that moves the order and its hold to `payment_pending`, before any network call. That covers return URLs, amount, currency, card-only `payment_method_types`, explicit `expires_at`, legal versions, `client_reference_id`, `metadata[order_ref]` and a random `metadata[attempt_nonce]`. It also stores the idempotency key `skyla:checkout-session:v2:<orderRef>:<nonce>`, the frozen Stripe mode and the pinned API version `2026-02-25.clover`. Credentials, return origins and the stored snapshot are checked first. A server-only SHA-256 fingerprint freezes the exact configured merchant credential before the first POST; every replay must match it, so a credential change cannot create a Session in a second merchant account. The raw credential is never stored or exposed.
- **Session lifetime.** Each Session expires 45 minutes after its request was frozen. That is inside Stripe's 30-minute to 24-hour range. The expiry is never recalculated.
- **Retries.** A retry, double click, reload or concurrent start resumes the stored attempt:
  - an open Session returns its stored URL, without a network call, while more than 2 minutes remain;
  - paid, closed, expiring and needs-help states return customer-safe 409 codes (`payment_already_received`, `payment_session_closed`, `payment_session_expiring`, `payment_needs_attention`, `payment_in_progress`).
- **Unknown creation outcome.** A timeout, 409, 429, 5xx or unreadable body keeps the hold. Only the exact stored body with the same key is replayed. Replays are lease-guarded, capped at 4 requests and allowed only within 10 minutes of the attempt. In that window the frozen expiry still clears Stripe's 30-minute minimum, and the window is far inside the 24-hour key retention. After it, the attempt becomes the exception `checkout_session_creation_outcome_unknown` and the hold stays until staff reconcile it. A pruned key is never replayed.
- **Definite rejection.** Only a structured Stripe 4xx validation or authorization error on the very first request proves nothing was created. It releases the hold (`stripe_creation_rejected`) and opens a visible exception.
- **Strict verification.** Every created or retrieved Session must match: object, id format, `livemode` against the frozen mode (missing counts as a mismatch), `mode=payment` (missing or other values count as a mismatch), order reference in both places, attempt nonce, integer amount, currency and, at creation, the frozen `expires_at`. On a mismatch the guest never receives the URL. The attempt becomes an exception and the hold is kept.
- **Legacy records.** A pre-attempt `payment_pending` order with a stored `created` event is adopted for read-only reconciliation; its request is never replayed. Its stored URL is returned only within the old default 24-hour lifetime. One without a stored Session opens `legacy_payment_pending_without_session`.

## Autonomous reconciliation of known Sessions

- **Scheduling.** Each attempt carries `reconcileAt`. Open Sessions are read just after their frozen expiry. Unknown creations are replayed inside the safe window. A 5-minute cron (`convex/crons.ts`) re-schedules due attempts whose scheduled action was lost, because Convex actions run at most once.
- **No overlapping effects.** A worker claims a 2-minute lease. Its result is applied only if both its lease token and the attempt version are still current, so overlapping workers, or a webhook that settled first, cannot apply a second effect.
- **Provider states** (`GET /v1/checkout/sessions/:id` only; automation never expires a live Session):

  | Provider state | Effect |
  | --- | --- |
  | paid | fulfilled through the same settlement as the webhook |
  | open | checked again after expiry, then backoff |
  | complete but unpaid | backoff, never released |
  | expired and unpaid, correlated | the only case that releases an unpaid hold |
  | 5xx or network error | backoff, then `checkout_reconciliation_exhausted_unknown` after 30 reads |
  | 404 or mismatch | exception |

- **Missing configuration.** A missing secret or a mode mismatch is recorded as a configuration state with a visible `checkout_reconciliation_unconfigured` exception. It retries at 15, 30 and then 60 minutes, and is bounded. The exception closes automatically once a read succeeds. The existing secret/mode guard runs on every scheduled read.

## Paid money is never lost

`convex/lib/checkoutSettlement.ts` handles both signed webhooks and provider reads.

- **One money record, one booking, one ticket, one delivery.** Repeated event ids, different event ids for the same Session or PaymentIntent, and a reconciliation read all reuse them. PaymentIntent identity is checked globally across orders; reuse on another order becomes an exception without another money record, booking or ticket. Ticket-delivery shape is preflighted before fulfillment so a corrupt existing delivery cannot roll back authoritative paid evidence. A second distinct payment for the same order is recorded as money with no second booking.
- **What is checked.** The webhook parser now forwards Session mode, livemode, status, payment status, attempt nonce and the signed event time. A paid Session with missing amount, currency or PaymentIntent is no longer silently ignored.
- **Fulfillment window.** Paid fulfillment does not reuse the purchase-time past-slot or past-date gate. A ticket is issued only when both the signed payment time and the processing time fall before the closing of the entered segment on the selected LA date. A same-day late arrival after the entry time is still fulfilled. A provider read has no trusted payment time, so it uses the processing time, which can only produce an exception, never a late ticket.
- **Billing exceptions.** Anything that blocks a ticket becomes an idempotent, audited exception (`operationsExceptions`, `moneyReceived: true`) with immutable first evidence. The order becomes `paid`, the money is in the ledger, the capacity row becomes or stays `exception` (counted, never released by billing), and no ticket or email is sent. Codes:
  - amount, currency, mode, livemode, nonce or Session mismatch;
  - uncorrelated Session or missing PaymentIntent;
  - `paid_after_visit_window` and `paid_fulfillment_after_visit_window`;
  - `paid_order_capacity_exception`;
  - `paid_after_order_closed`, for example a paid event after a correlated expiry released the hold, which is re-counted;
  - an invalid stored snapshot.

  For mismatch cases the evidence stays on the exception and is not written as a paid ledger row.
- **Refunds** stay staff-authorized and are never executed automatically. A staff refund of an exception order still reconciles through the existing refund webhook.
- **Customer-facing status.** Return and attempt status now include `needs_attention` (paid, needs help, don't pay again).

## Ticket delivery

- **Configuration first.** The email configuration is checked before a claim, so missing configuration never starts the key window. It is recorded as `email_provider_unconfigured` with a visible exception and bounded backoff, and the exception closes after a later successful send.
- **Paid bookings only.** Sends go only to confirmed or already checked-in bookings whose order or POS sale is `paid`. Cancelled, refunded, unpaid and unresolved billing-exception bookings are suppressed. A confirmation received after check-in does not restore admission or re-entry.
- **Unknown outcomes** (network, 409, 5xx, stale sending lease) and 429 retry automatically with the same `skyla-ticket/<code>/<version>` key. Retries are bounded and backed off, and stop 20 hours after the key was first used, before Resend's 24-hour retention ends. After that the delivery becomes `email_delivery_unknown_after_idempotency_window`, an exception with no automatic email.
- **Permanent 4xx failures** (bad recipient, sender or key) are exceptions with no retry.
- **Provider identity.** Before the first send, a server-only fingerprint freezes the configured API key, sender, reply address and public origin. An unknown-result retry with changed configuration is blocked rather than sent under another provider identity.
- **Delivery tracking.** A bounded, leased read-only `GET /emails/:id` verifies the message id and recipient before recording the provider’s `last_event`. Accepted and delivered are separate facts; bounced, complained, failed, suppressed and canceled messages become staff exceptions. Tracking never automatically resends. Delivery means acceptance by the recipient mail server, not proof of a human inbox receipt. Reads stop after 30 attempts or seven days; newly accepted messages are scheduled, older already-sent records require an audited backfill.
- **Cron repair** handles queued sends whose schedule was lost, stale leases, due retries and delivery tracking.
- **Staff resend after the window** uses a new, audited version. Staff may knowingly accept a possible duplicate.

## Browser safeguards

- **One payment per browser.** The checkout stores one same-browser payment intent in `localStorage` before the payment request: order reference and its private key, with no email or ticket. All tabs of that browser read it through `useSyncExternalStore`. A ref blocks double clicks. Storage must succeed and read back before the request starts; blocked/full storage prevents payment with a recoverable customer message.
- **Locked until settled.** After a reload, a Stripe "back" or a lost response, the page asks `POST /api/payments/stripe-checkout/status` with `{orderRef, idempotencyKey}`. That reads stored state only and never trusts browser amounts. Review, payment and new orders stay locked until the attempt is settled. "Return to payment" reopens the same Session. Nothing reads as paid before confirmation. An unresolved Stripe return also locks purchases when no saved browser intent exists. A `not_started` read cannot unlock an uncertain order until an atomic draft-only abandonment succeeds; a concurrent payment start keeps the lock.
- **Releasing a replaced draft.** Changing a reviewed order calls `POST /api/order-drafts/checkout/release`. It uses the trusted gateway, rate limit and sales lock. It releases only a still-`draft` order whose key matches and that has no attempt; it never touches `payment_pending`.
- **Unchanged.** Prices, the full-venue link, aggregate availability, stale-response protection and the 44px controls are unchanged.

## Staff read

`operationsExceptions.listOperationsExceptions` (admin and viewer only, bounded to 50, masked provider ids) and `GET /api/admin/exceptions`. This is read-only. Resolution, refunds and the staff UI belong to the operations milestone.

## Independent acceptance and remaining limits

1. **Local acceptance.** Final `bun run check` exited 0: 798 tests, lint, types, production build and both security guards. The actual anonymous local database/HTTP webhook proof covered forged signatures, repeated/reordered events, global PaymentIntent reuse, late paid-after-expiry evidence, missing modern payment facts, unpaid Session ticket suppression, never-TTL-released uncertainty and admin/viewer versus POS/anonymous exception roles. These synthetic identities do not prove Clerk authentication. Official local Convex codegen completed after the repairs.
2. **Rendered evidence.** Existing main Chrome was used for normal desktop (actual 1512px), verified 390px/320px checkout layouts, paid-exception and pending return locks, and a loaded 260px ticket QR. No overflow; count controls are 44px. The local QR uses an intentionally invalid test origin, never a production ticket. The QR initially failed because the isolated public-origin setting was missing; configuring the isolated test origin repaired it. The existing ticket page needs graceful QR-error handling and admission-policy wording in milestone 4. Compiled production continues to ignore the local render preview and reject sale/draft-release requests with 503.
3. **Provider linkage.** Stripe, Convex, Clerk and Resend accounts and original Vercel team access still need verification. No actual Stripe test payment, inbox receipt, authenticated staff-device proof, sender-domain verification or production deployment was performed. Provider simulations do not replace these gates. Older sent emails are not automatically backfilled into delivery tracking.
4. **Manual exceptions.** Unknown Session creation beyond the safe replay window is retained for staff reconciliation. Paid-after-closing orders retain money and capacity as exceptions. Refunds, rescheduling and resolving money exceptions stay staff-authorized; they are not executed automatically. Existing legacy-capacity reconciliation remains fail-closed. Staff admission, occupancy/departure, operations UI, both-journey provider completion and physical printed QR proof remain separate milestones.
5. **Model evidence and ownership.** The corrected substantial implementation used actual `claude-opus-5-5` (289 turns, 42m43s). Exact-model repair hit the subscription session limit with no edits; Codex made and independently validated the bounded repairs. No fallback model is represented as Opus. Protected local sources and Hermes’s `design/skydeck-redesign` remained unchanged; nothing was pushed, merged, sent or deployed. Evidence is in `/Users/jheller/Documents/Codex/2026-10-02/skydeck-ticketing-research/payment-milestone-evidence.md`.
