# SkyDeck admission and operations, October 2, 2026

The owner approved the five-milestone research plan and autonomous implementation in isolated test work. Production deployment, live charges, purchases and external messages require separate approval after the result is reviewable.

Confirmed offer: adults 18+ pay $20; ages 8–17 pay $10; ages 0–7 are free, every day. Displayed admission prices are charged prices with no extra booking fee. All three categories count toward the owner-confirmed capacity of 30. Tickets are valid on their selected America/Los_Angeles calendar date during operating hours. There is no existing normal-visit booking URL to preserve.

The capacity interpretation (simultaneous occupancy or total daily reservations) and re-entry policy are pending owner clarification. Neither may be inferred from price or same-day validity. Do not enable sales until capacity and admission enforcement are complete.

Authority: transaction routes come from junyengit/skyla at 753d02f; canonical homepage/assets/inquiry are rewritten to the separate skydeck-vercel deployment. The current branch codex/skydeck-ticketing-20261002 is isolated from all existing working copies. Hermes's design/media/inquiry assignments and the other SkyDeck redesign chat remain reserved. No homepage redesign, branch switching, PR merging, production writes or BestSpace changes are authorized here.

Existing authenticated HighLevel agency inventory showed one sub-account, BestSpace, on October 2. SkyDeck will use its existing Convex/Stripe/Clerk/Resend stack for its authoritative calendar, bookings, billing, ticket delivery and exception queue. Optional CRM mirroring can be assessed later with a dedicated SkyDeck account; CRM synchronization must never determine paid status, ticket issuance or capacity availability. No external account was created or changed.

Operations design: durable mutations record booking/payment/admission state and audit; signed provider events reconcile payments and refunds; bounded scheduled jobs retry uncertain provider operations and surface exceptions. Staff manage confirmed private-event blocks in the authoritative venue calendar. An inquiry alone does not reserve the venue. External side effects remain outside Convex transactions. No automatic refunds or customer messages are authorized until separately approved.

Implementation preference: exact claude-opus-5-5 for substantial changes, independently reviewed by Codex. The actual returned model is recorded for each run. The owner preference takes precedence over the hub's default Kimi UI routing. Apply the project-scoped Creative OS workflow from /Users/jheller/Desktop/real outreach/creative-os/skills/creative-os/SKILL.md.

Design: guests standing outside/in the lobby on phones need direct date/time → party/price → hosted payment → ticket; staff need immediate, unambiguous validation. Hypothesis: first-time guests can complete that task within two minutes without staff help. The approved research report contains three divergent directions; choose the direct linear flow in hybrid mode. Native scrolling, clear back/full-venue navigation, one-column mobile layout, useful state feedback and no decorative motion. Reuse the existing transaction mechanics and SkyDeck identity. The structural fingerprint is a bounded task form plus receipt, separate from the reserved scroll-world homepage. No new media or component library is required.

Validate, inspect rendered desktop/mobile states, repair and record each substantial change before the next. Green CI alone is insufficient. Cloud provider linkage, real test payment/inbox delivery, physical QR tests and the Creative OS release gate remain required before promotion.
