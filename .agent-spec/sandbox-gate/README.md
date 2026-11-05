# SkyDeck admission sandbox gate

A narrow, opt-in test checkout for exactly one isolated backend and one Vercel
Preview branch. `siteConfig.launched` stays `false`. Production, local
development, and every other deployment keep the existing closed behavior.

Nothing here proves a real Stripe payment, staff sign-in, email delivery, or a
printed QR scan. Unit tests use fixtures and mocked network calls only.

## Pinned in reviewed source

`packages/config/src/sandbox-admission.ts` (exported from `@skyla/config`):

| Binding | Value |
| --- | --- |
| Convex Preview | `bold-reindeer-495` |
| Cloud URL | `https://bold-reindeer-495.convex.cloud` |
| Site URL | `https://bold-reindeer-495.convex.site` |
| Gate cutoff | `2026-10-12T04:00:00Z` (provider expiry is about `2026-10-13T04:19Z`) |
| Vercel project | `prj_fhlOjcwSbnPAuLi8tTiGbhjVomnr` (Junyen `web`) |
| Vercel branch | `codex/skydeck-sandbox-gate-20261003` |
| Always rejected | `grand-ferret-807` (revoked), `disciplined-chickadee-688` (original Dev), `perceptive-fox-396` (original Prod) |

Changing any of these is a code change. No environment variable can select a
different backend, project, branch, cutoff, or origin pattern.

## Exact opt-in environment contract

### Vercel Preview (web, branch-scoped)

Set by the operator:

| Name | Required value |
| --- | --- |
| `SKYLA_SANDBOX_ADMISSION` | `bold-reindeer-495` |
| `SKYLA_SANDBOX_ADMISSION_ORIGIN` | `https://` + the branch URL Vercel assigns (see below) |
| `SKYLA_PUBLIC_ORIGIN` | the same origin (ticket QR links) |
| `SKYLA_STRIPE_MODE` | `test` |
| `SKYLA_PUBLIC_GATEWAY_SECRET` | the Preview gateway secret shared with `bold-reindeer-495` (existing setting) |
| Convex target slots | every one of `CONVEX_SITE_URL`, `CONVEX_URL`, `NEXT_PUBLIC_CONVEX_URL` that is set must be exactly the pinned value: `https://bold-reindeer-495.convex.site` for the site slot, `https://bold-reindeer-495.convex.cloud` for the cloud slots. At least one must be set. |

Supplied by Vercel and checked exactly:

| Name | Required value |
| --- | --- |
| `VERCEL` | `1` |
| `VERCEL_ENV` | `preview` |
| `VERCEL_TARGET_ENV` | `preview` |
| `VERCEL_PROJECT_ID` | `prj_fhlOjcwSbnPAuLi8tTiGbhjVomnr` |
| `VERCEL_GIT_COMMIT_REF` | `codex/skydeck-sandbox-gate-20261003` |
| `VERCEL_BRANCH_URL` | must equal the configured origin without `https://` |
| `VERCEL_URL` | must not equal the configured origin (unique deployment URL is never approved) |
| `VERCEL_PROJECT_PRODUCTION_URL` | must not equal the configured origin |
| `NODE_ENV` | `production` (compiled build mode) |

The configured origin must be exactly `https://web-git-<branch>-junyen-enterprises.vercel.app`:
one lowercase DNS label of at most 63 characters, no port, path, query,
fragment, credentials, trailing slash, or list. Do not guess it: read the
stable branch URL from the Vercel deployment (it equals `VERCEL_BRANCH_URL`).
If Vercel truncates the label so it no longer starts with `web-git-` and ends
with `-junyen-enterprises`, the gate stays closed and the binding needs review.

Because the origin is matched to the stable branch URL, redeploying the branch
(which changes `VERCEL_URL`) does not require reconfiguration.

### Convex `bold-reindeer-495` (backend)

| Name | Required value |
| --- | --- |
| `SKYLA_SANDBOX_ADMISSION` | `bold-reindeer-495` |
| `SKYLA_SANDBOX_ADMISSION_ORIGIN` | the same approved Vercel branch origin |
| `SKYLA_PUBLIC_ORIGIN` | the same origin |
| `SKYLA_PAYMENT_RETURN_ORIGINS` | the same origin, as the only entry |
| `SKYLA_STRIPE_MODE` | `test` |
| `STRIPE_SECRET_KEY` | a Stripe `sk_test_` secret key (restricted `rk_` and live keys are rejected) |
| `SKYLA_PUBLIC_GATEWAY_SECRET` | existing gateway secret, matching Vercel |
| `STRIPE_WEBHOOK_SECRET` | existing webhook verification (unchanged) |
| `CONVEX_CLOUD_URL`, `CONVEX_SITE_URL` | Convex system values; must be the pinned pair |

Ticket email (`RESEND_API_KEY`, `SKYLA_TICKET_FROM_EMAIL`) and staff sign-in
(Clerk) are not part of this gate and are unchanged.

## Behavior

Web purchase APIs (`/api/order-drafts/checkout`, `/api/order-drafts/checkout/release`,
`/api/payments/stripe-checkout`) through `app/api/ticket-sales-gate.ts`:

1. `launched=true`: unchanged.
2. Not the verified sandbox: unchanged `503 ticket_sales_not_live`, before parsing or forwarding.
3. Verified sandbox: the request's `Origin` header must be exactly the approved
   origin and the request URL must be on that exact origin. `X-Forwarded-Host`,
   `X-Forwarded-Proto`, and `Forwarded` never substitute for either; when
   present they must agree. Otherwise `403 sandbox_origin_rejected`, before
   parsing or forwarding.
4. The gate also calls the real gateway resolver and requires it to return the
   pinned site URL, so it never approves one URL and forwards to another.

`/checkout` SSR uses only the server predicate (never request headers). In the
verified sandbox it renders the existing checkout with one notice,
"Test checkout. No real money is charged.", in the existing
`checkoutPreviewNotice` treatment. Elsewhere it renders the unchanged
pre-launch page. The local visual preview is unchanged and still cannot
purchase.

Convex `/public-gateway`: bearer authorization, the 32 KB size limit, and payload
parsing run first, unchanged. Durable rate limits run inside the unchanged
dispatched handlers. The three purchase operations
then dispatch only if `convex/lib/sandboxAdmission.ts` independently confirms
the pinned system URLs, opt-in, cutoff, test mode, `sk_test_` key, and the one
approved origin across all three origin settings. Pricing, capacity, payment
idempotency, return-origin enforcement, webhook signature and mode checks, and
fulfillment are untouched.

## Design decisions

- Customer contract (from BRIEF): visitors and staff on phones in the lobby
  need date, party, price, and whether money moved. The proof order stays the
  existing single checkout: heading, pricing and party, date and time, review,
  payment, confirmation.
- Selected direction 1 of 3: a plain in-flow notice before the existing
  checkout. Rejected: a separate test landing step (adds a step unrelated to
  admission) and an overlay or watermark (covers mobile controls and the QR).
- Mode: hybrid, reusing this customer's accepted checkout. No new CSS, motion,
  layout, or component. Page physics unchanged: linear document, native
  scroll, anchor link to full-venue booking, no overlays on mobile.
- The notice reuses the local preview's `checkoutPreviewNotice` box and
  `role="note"`, so it shares the existing typography and 320px behavior, and
  it sits above the `Checkout` heading where the local preview notice already
  appears in the accepted screenshots.
- Copy is exactly the brief's suggestion. It does not mention paid admission.
- Implementation choices: the opt-in value is the deployment name, not `1`, so
  an opt-in cannot be satisfied by a generic toggle. The web side also
  requires `SKYLA_PUBLIC_ORIGIN` to equal the approved origin so ticket QR
  links lead back to the same Preview. `NODE_ENV=production` excludes local
  `next dev` runs with pulled Preview variables. An origin-rejected sandbox
  request returns a distinct `403` so a tester on the wrong alias sees why.

## Known limitations

- Metadata description on `/checkout` is static and still reads as pre-launch
  in the sandbox (not visible on the page).
- Visiting the sandbox through the unique deployment URL renders the test
  checkout (SSR never reads request headers) but every purchase POST returns
  `403`. Use the stable branch URL.
- The repository root `README.md` is outside the authorized edit scope; this
  file is the env contract documentation.
- `scripts/setup/check-vercel-env.mjs` does not know the new names; it was not
  changed (protected path).
- The Vercel branch URL's exact hostname was not observed. Tests use the
  labeled fixture `web-git-sandbox-fixture-junyen-enterprises.vercel.app`.
- No provider operation, Preview deployment, payment, ticket, staff admission,
  or email was performed or proven.

## Visual states for review

- `/checkout` verified sandbox at 320px and desktop: one test notice above
  `Checkout`, existing form, counters, time grid, order summary, full-venue link.
- `/checkout?stripe=success&session_id=...` and `?stripe=cancel` in sandbox: notice persists.
- Review and payment error states, including a `403 sandbox_origin_rejected` message.
- Production or any unverified context: unchanged pre-launch page and banner.
- Local visual preview (`SKYLA_LOCAL_ADMISSION_PREVIEW=1`): unchanged "Local preview only" notice.
- Reduced motion, keyboard focus order, and no-JS SSR legibility of the notice.
