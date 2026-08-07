# Direction record

## A — Inline final checklist (selected)

Place a compact semantic fieldset inside the order summary, immediately above the payment CTA. Keep the two acceptances separate and show a short readiness line when payment is locked.

- Fit: highest; consent is adjacent to the action it governs.
- Content requirement: exact short-form assent text and two legal links.
- Accessibility/performance risk: low with native controls and no dependency.
- Wrong if: the block becomes dense fine print or visually separates from payment.

## B — Consent modal (rejected)

Open a blocking modal when the purchaser clicks payment, with checkboxes and legal summaries.

- Fit: superficially prominent but interrupts context.
- Risk: nested scrolling, focus management, small-screen crowding, and accidental dismissal.
- Wrong because: it delays disclosure until after the purchaser tries to pay and resembles coercive click-through consent.

## C — Dedicated review step (rejected for this scope)

Convert checkout into a multi-step sequence with a separate legal-review screen before Stripe.

- Fit: strongest for complex per-participant signatures later.
- Risk: significantly larger state, routing, persistence, and abandonment surface.
- Wrong now because: the current request needs a focused pre-payment gate; other adult/minor signatures can remain an entry-readiness workflow.

## Portfolio similarity check

Removing brand tokens leaves the existing Sky LA checkout structure plus one native fieldset. It does not reproduce a prior landing-page hero, card grid, reveal preset, or motion vocabulary.
