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
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | yes | Vercel | Production/Preview/Development | Browser-safe Stripe.js publishable key. | Needed only when frontend is wired to Stripe.js or embedded Checkout. |
| `KASKADE_API_KEY` | no | Convex | Production/Preview/Development | Future Kaskade payment action secret. | Not ready; legacy bridge still exists. |
| `SKYLA_TERMINAL_SETUP_TOKEN` | no | Supabase legacy, later Convex | Production only | One-time manager token for Stripe Terminal reader setup. | Legacy hardening is present; Terminal payment creation still needs replacement. |
| `SKYLA_ENABLE_LEGACY_BROWSER_PAYMENTS` | no | Supabase legacy only | Transition only | Emergency opt-in for the old browser-authoritative Supabase Stripe Checkout create/update actions. | Leave unset/false; repo code fails closed by default. |
| `SKYLA_ENABLE_LEGACY_TERMINAL_BRIDGE` | no | Supabase legacy only | Transition only | Emergency opt-in for the old browser-reachable Supabase Terminal connection/list/create-intent bridge. | Leave unset/false; repo code fails closed by default. |
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

## Raw Agent Checks

```bash
PATH="$HOME/.bun/bin:$PATH" bun run convex:env:check
PATH="$HOME/.bun/bin:$PATH" bunx vercel env ls
PATH="$HOME/.bun/bin:$PATH" bun --revision
```

Do not print secret values in logs, PRs, or docs. Check presence, scope, and
shape only.
