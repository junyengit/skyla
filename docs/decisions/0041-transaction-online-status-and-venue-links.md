# Transaction online status and venue links

Owner confirms normal visits and full-venue bookings operate. The false `siteConfig.launched` value disables online ticket purchasing; it must not imply that only private bookings operate. Checkout metadata, status copy and contact panel now distinguish that gate from venue operations. Purchase/API gates remain disabled.

The split production homepage uses `#venue-booking`. Transaction legal and public-shell links now target that exact anchor. Protected homepage/showcase/Hermes sources remain untouched.

Validation:1476 deterministic tests plus lint,types,build and security-artifact checks passed. Actual production-mode local checkout was inspected in the existing mainChrome at320,390 and1512px; scoped brand/contact44px target repair and reduced-motion auto scrolling verified. Keyboard focus is visible, console clean, privacy/terms hrefs exact. Actual POST to checkout-draft still returns no-store503 `ticket_sales_not_live` before provider dispatch. Live homepage rendered anchor verified without sending an inquiry.

Evidence: `/Users/jheller/Documents/Codex/2026-10-02/skydeck-ticketing-research/transaction-copy-checkpoint.json`, final build `OZ1MoTZKPNokjNK--Brri`, `transaction-copy-full-check-result.json`, `transaction-copy-browser-metrics.json`, `transaction-copy-visual-review.md`. Original three stale-copy test failures and initial render retained; assertions updated, scoped visual repairs checked. No isolated automation browser launched.

Local functional checkpoint only. CreativeOS grading/portfolio/performance and original provider/deployment account gates remain open, so no production promotion is claimed. No deployment, messages, provider calls or money events. No exact Opus availability or Kimi credits; current Codex fallback uses the user-supplied authorization already recorded.
