# Environment Reference

This matrix lists the current environment variables needed during the Skyla
Vercel, Convex, and payment migration. It is intentionally plain: public means
safe for browser code, secret means dashboard/server only.

## Human Summary

- Vercel owns the web app environment.
- Convex owns database functions and payment actions.
- Stripe keys stay server-side except the publishable key.
- The live site can keep running without Convex envs, but payments should not
  move to the new Convex Stripe action until Convex and Stripe envs are both
  configured.

## Matrix

| Variable | Public? | Set In | Scope | Why It Exists | Current Gate |
| --- | --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | yes | Vercel | Production/Preview/Development | Browser-safe canonical URL. | Helpful for UI links and return URLs. |
| `NEXT_PUBLIC_CONVEX_URL` | yes | Vercel | Production/Preview/Development | Lets Next routes call the linked Convex deployment. | Required for persisted checkout drafts from Vercel. |
| `CONVEX_DEPLOYMENT` | no | local + Convex CLI | local/dev | Links local codegen to the real Convex project. | Must not be `anonymous:*` for cloud readiness. |
| `CONVEX_URL` | no | local + Convex CLI | local/dev | Server-side Convex URL for local verification. | Must be HTTPS for cloud; localhost only for anonymous local testing. |
| `STRIPE_SECRET_KEY` | no | Convex | Production/Preview/Development | Allows Convex actions to create Stripe Checkout Sessions and Stripe Terminal PaymentIntents. | Required before `payments.createStripeCheckoutSession` or `payments.createStripeTerminalPaymentIntent` can run. |
| `SKYLA_PAYMENT_RETURN_ORIGINS` | no | Convex | Production/Preview/Development | Comma-separated allowed origins for Stripe success/cancel URLs. | Required; example `https://skydeckla.com,https://www.skydeckla.com`. |
| `STRIPE_WEBHOOK_SECRET` | no | Convex | Production/Preview/Development | Verifies Stripe webhook signatures for `POST /stripe-webhook`. | Required before webhook cutover. |
| `SKYLA_TERMINAL_READER_REGISTRY` | no | Convex | Production/Preview/Development | Comma-separated trusted Stripe Terminal readers, optionally paired to locations as `tmr_reader@tml_location`. | Required before `/pos-next` can persist a reader or process a reader handoff. |
| `SKYLA_STAFF_BOOTSTRAP_TOKEN` | no | Convex | Temporary setup only | Authorizes the typed `staffBootstrap.upsertStaffUser` seed mutation before any staff rows exist. | Set only while seeding staff, then remove or rotate. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | yes | Vercel | Production/Preview/Development | Browser-safe Stripe.js publishable key. | Needed only when frontend is wired to Stripe.js or embedded Checkout. |
| `KASKADE_API_KEY` | no | Convex | Production/Preview/Development | Future Kaskade payment action secret. | Not ready; legacy bridge still exists. |
| `SKYLA_TERMINAL_SETUP_TOKEN` | no | Supabase legacy, later Convex | Production only | One-time manager token for Stripe Terminal reader setup. | Legacy setup hardening is present; Terminal payment creation is replaced in repo code but the live reader flow still needs Convex envs and UI acceptance. |
| `SUPABASE_URL` | mixed | Vercel/Supabase legacy | Transition only | Keeps compatibility pages talking to legacy Supabase. | Keep only until Convex replacements are accepted. |
| `SUPABASE_ANON_KEY` | yes-ish | Vercel/Supabase legacy | Transition only | Legacy browser reads/writes through existing bridge. | Do not add service-role powers to browser paths. |
| `SUPABASE_SERVICE_ROLE_KEY` | no | server only | Transition only | Legacy server migration/admin tasks. | Never expose to `NEXT_PUBLIC_*`; avoid Preview production access. |
| `NEXT_PUBLIC_GOOGLE_ADS_TAG_ID` | yes | Vercel | Production/Preview | Google Ads tag for compatibility pages. | Optional; blank keeps tracking inert. |
| `NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_CONVERSION` | yes | Vercel | Production/Preview | Purchase conversion label. | Optional until paid ads are active. |

## Stripe Return Origins

`SKYLA_PAYMENT_RETURN_ORIGINS` must contain origins only, not full paths:

```text
https://skydeckla.com,https://www.skydeckla.com,https://web-<preview>.vercel.app
```

Good:

- `https://skydeckla.com`
- `https://www.skydeckla.com`
- `http://localhost:3000`

Bad:

- `https://skydeckla.com/checkout`
- `http://skydeckla.com`
- `https://example.com`

## Terminal Reader Registry

`SKYLA_TERMINAL_READER_REGISTRY` is a Convex-only allowlist. The POS screen can
send a reader selector, but Convex stores it only when the reader is in this
registry.

```text
tmr_frontdesk@tml_lobby,tmr_bar@tml_rooftop
```

Good:

- `tmr_frontdesk@tml_lobby`
- `tmr_frontdesk`

Use the paired `reader@location` form when possible. If a location is paired in
the registry, browser-sent locations must match it; if no registry is set,
reader persistence fails closed.

## Raw Agent Checks

```bash
PATH="$HOME/.bun/bin:$PATH" bun run convex:env:check
PATH="$HOME/.bun/bin:$PATH" bunx vercel env ls
PATH="$HOME/.bun/bin:$PATH" bun --revision
```

Do not print secret values in logs, PRs, or docs. Check presence, scope, and
shape only.

## Staff Bootstrap Token

Use `SKYLA_STAFF_BOOTSTRAP_TOKEN` only to create or update initial
`staffUsers` rows after the real Convex project is linked. It must be at least
32 characters and contain no whitespace.

After staff is seeded and a real staff bearer token can load `/admin`, remove
the bootstrap token from Convex:

```bash
PATH="$HOME/.bun/bin:$PATH" bunx convex env remove SKYLA_STAFF_BOOTSTRAP_TOKEN
```
