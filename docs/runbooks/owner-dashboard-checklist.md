# Skyla Owner Dashboard Checklist

This is the short owner-only sequence for dashboard changes. Do not paste
secret values into issues, PRs, logs, or documentation. Keep real cards off
through all migration verification.

## 1. Convex, Clerk, And Vercel

- [ ] In Vercel Billing, confirm the team has an active plan or owner-managed
      payment method so hosting will not pause when the current trial ends. Do
      not paste card details into Codex, GitHub, logs, or environment variables.
- [ ] In Vercel Domains, confirm `skydeckla.com` and `www.skydeckla.com` both
      show **Valid Configuration** with issued SSL certificates. Keep the
      GoDaddy nameservers pointed at Vercel.
- [ ] In GitHub repository **Settings > Releases**, enable release immutability
      before the next Bun toolchain pin is published. GitHub applies this only
      to future releases, so leave the current checksum-pinned mirror intact and
      create the next toolchain release only after the setting is enabled.
- [ ] Create or link separate Convex development and production deployments.
      Do not apply legacy data yet.
- [ ] Create the restricted Skyla staff application in Clerk, enable its Convex
      integration, and record the issuer for each matching Convex deployment.
- [ ] In Vercel, bind the Convex development URL to Preview only and the Convex
      production URL to Production only. Add both Clerk keys to Preview and
      Production; only the publishable key may use `NEXT_PUBLIC_*`.
- [ ] Generate two independent random values of at least 32 characters for
      `SKYLA_PUBLIC_GATEWAY_SECRET`. Put the Preview value in Vercel Preview and
      the Convex development deployment; put the Production value in Vercel
      Production and the Convex production deployment. Never create one shared
      Preview/Production binding and never expose this value through
      `NEXT_PUBLIC_*`.
- [ ] In each Convex deployment, set the matching Clerk issuer. Put Stripe keys,
      webhook secrets, staff bootstrap tokens, and the Terminal reader registry
      in Convex only, never Vercel.
- [ ] Verify a Skyla sending domain in Resend. Put `RESEND_API_KEY`,
      `SKYLA_TICKET_FROM_EMAIL`, and the optional `SKYLA_TICKET_REPLY_TO` in the
      matching Convex deployment. Add separate Preview-only and Production-only
      `SKYLA_PUBLIC_ORIGIN` bindings in Vercel, then set the exact same HTTPS
      origin in each matching Convex deployment.
- [ ] Keep the Google Ads public variables unset unless ads are being launched;
      they are optional and blank values keep tracking inert.
- [ ] Decide explicitly whether Apple and Brevo still require DNS verification.
      Preserve or restore their records only after that owner decision; do not
      treat historical DNS values as proof that either service is active.
- [ ] Run `bun run vercel:project:check`, `bun run vercel:env:check`,
      `bun run convex:env:check`, and `bun run dashboard:readiness`.
      Inquiry, membership, checkout-draft, and Stripe Checkout writes must
      return `503` until the matching gateway secret is present on both sides.

## 2. Stripe Test Setup

- [ ] Keep Stripe in **test mode**. In each matching Convex deployment, set
      `SKYLA_STRIPE_MODE=test`, the environment's `sk_test_...`
      `STRIPE_SECRET_KEY`, and `SKYLA_PAYMENT_RETURN_ORIGINS`. Do not put these
      values in Vercel.
- [ ] In Stripe Workbench, create a webhook endpoint at
      `https://<convex-deployment>.convex.site/stripe-webhook`. Subscribe it to
      `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
      `checkout.session.async_payment_failed`, `checkout.session.expired`,
      `payment_intent.succeeded`, `payment_intent.payment_failed`,
      `payment_intent.canceled`, `refund.created`, `refund.updated`, and
      `refund.failed`.
- [ ] Put that endpoint's test signing secret in the matching Convex
      `STRIPE_WEBHOOK_SECRET`. Confirm the key, endpoint, and secret all belong
      to the same Stripe mode and Convex environment.
- [ ] Register only Stripe test Terminal readers/locations in
      `SKYLA_TERMINAL_READER_REGISTRY`. Do not use a live reader or real card.
- [ ] Keep the code and webhook endpoint on `2026-02-25.clover` for the first
      linked acceptance. [Stripe currently documents
      `2026-06-24.dahlia`](https://docs.stripe.com/api/versioning); treat that
      named-major upgrade as a separate Workbench change with matching webhook
      version, regression tests, and rollback review.

## 3. Linked Preview Acceptance

- [ ] Bootstrap the first Clerk user into Convex `staffUsers`, remove
      `SKYLA_STAFF_BOOTSTRAP_TOKEN`, and seed the code-owned catalog.
- [ ] Run `bun run test:acceptance:preflight` against the linked Vercel Preview
      branch alias before any write or reader attempt.
- [ ] For the controlled test-reader window only, set
      `SKYLA_POS_TERMINAL_ACCEPTANCE=enabled` in Vercel Preview and the matching
      Convex development deployment. Verify the Vercel latch with
      `SKYLA_VERCEL_TERMINAL_ACCEPTANCE_TARGET=preview bun run vercel:env:check`.
- [ ] Run `bun run test:acceptance:linked` with Stripe test cards/readers. The
      harness proves persisted member, inquiry, checkout, and POS drafts,
      server-owned totals, Checkout Session creation, and reader handoff.
- [ ] Complete a separate Stripe-hosted test checkout and use Workbench test
      delivery/replay tools to verify signed webhook reconciliation, replay
      safety, the public QR ticket, and one delivered test confirmation email.
      Verify Admin can see delivery state and requeue a failed message, run the
      refund cases below, then remove the Terminal latch from Vercel and Convex.
- [ ] If Admin reports `email_delivery_outcome_unknown`, retry within Resend's
      24-hour idempotency window so Skyla reuses the same send key. If the event
      is older, inspect the Resend dashboard before any new send to avoid a
      duplicate. See [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys).
- [ ] Repeat production acceptance only after Preview passes and the owner
      explicitly approves the production window. Real cards remain disallowed.

## 4. Legacy Data Migration

- [ ] Follow [ADR 0032](../decisions/0032-ledgered-supabase-convex-migration.md)
      and the [migration runbook](supabase-convex-data-migration.md). Migrate
      only bookings, members, and inquiries.
- [ ] Record the immutable export and SHA-256 manifest, reach zero unresolved
      quarantine, apply and reconcile development first, then require explicit
      production confirmation.
- [ ] Remove `SKYLA_DATA_MIGRATION_TOKEN` after reconciliation or rollback and
      retain Supabase read-only until the owner makes the retention decision.

## 5. Legacy Payment Retirement

- [ ] In Stripe Workbench, inventory every endpoint that still targets a
      Supabase function. Disable the old endpoint only after the matching Convex
      test endpoint has passed signed-event and replay acceptance.
- [ ] In the old Supabase project, record whether `stripe-checkout`,
      `stripe-terminal`, `stripe-webhook`, `kaskade-payment`, and
      `kaskade-webhook` are deployed. Disable them or redeploy the tracked HTTP
      `410` retirement stubs; do not leave an old payment path callable.
- [ ] Run `SKYLA_SUPABASE_RETIREMENT_LIVE=1
      SKYLA_SUPABASE_RETIREMENT_BASE_URL=https://<project-ref>.supabase.co/functions/v1
      bun run test:supabase-retired:live` and retain the result with the cutover
      evidence.
- [ ] After Convex production reconciliation and the owner-approved retention
      window, export any required backup and remove the obsolete Supabase
      deployment. Keep GitHub Pages disabled; Vercel remains the only web host.
