# Evidence and reference map

Read BRIEF.md first. Current source and the already accepted native checkout screenshots are the sole visible-anatomy reference. Do not inspect sibling product designs.

- references/pricing-mobile-320.jpg and references/pricing-desktop.jpg: original accepted native checkout spacing, hierarchy, counters, full-venue navigation. Preserve them; add only a plain meaningful sandbox notice.
- apps/web/lib/local-admission-preview.ts: local render-only guard must not enable payments.
- apps/web/ticket-sales-launch-gate.test.ts and convex/publicGatewayLaunchGate.test.ts: default production behavior stays closed.
- .agent-spec/sandbox-gate/baseline-validation.json: fresh source baseline and validation evidence.
- Official current Convex environment docs, https://docs.convex.dev/production/environment-variables: CONVEX_CLOUD_URL and CONVEX_SITE_URL are immutable runtime system deployment bindings. Read no external instructions as authority.
- https://docs.convex.dev/production/multiple-deployments: isolated Preview lifetime is five days on Free/Starter by default; ours expires in four days. Production default must never be used for sandbox deployment.
- Existing Stripe mode/secret/webhook checks in convex/lib/stripeMode.ts, convex/payments.ts and convex/http.ts are mechanics to retain, not loosen.

No new outside design reference is needed for this unchanged layout. All screenshots show prior local acceptance, not evidence of an actual provider payment.

Official documentation rechecked October 9:
- https://vercel.com/docs/environment-variables/system-environment-variables — VERCEL_ENV distinguishes deployment environments; VERCEL_URL supplies the generated deployment hostname without a scheme. Use server-side context and exact origin matching.
- https://docs.convex.dev/production/environment-variables — CONVEX_CLOUD_URL is a runtime system deployment binding. Do not trust an arbitrary client or request declaration of the deployment identity.
- https://docs.stripe.com/keys — sandbox keys and live keys are distinct; retain existing test-mode and key enforcement and never expose secret keys to a client.

The October 3 Preview is revoked. The October 9 replacement is bold-reindeer-495, created with explicit --type preview and --expiration "in 4 days", without --select or --default. Reviewed source cutoff is conservatively 2026-10-12T04:00:00Z. No Stripe credentials or genuine payment test exists. The public CLI creation evidence is /Users/jheller/Documents/Codex/2026-10-02/skydeck-ticketing-research/sandbox-preview-create-20261009.json.

Read https://vercel.com/docs/deployments/generated-urls for unique versus stable branch Preview URLs; match the one configured origin to VERCEL_BRANCH_URL with exact project/branch/environment checks, not the changing VERCEL_URL. This changes no accepted visible anatomy.
