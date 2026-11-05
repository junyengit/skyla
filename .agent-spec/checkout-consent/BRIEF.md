# Sky LA checkout legal-consent brief

## Ground truth

- Sky LA is an open-air observation deck and lounge in Los Angeles.
- The venue has not launched. `siteConfig.launched` remains `false`, so the public checkout must continue to show no booking or payment controls.
- A future launched checkout already supports order review followed by hosted Stripe card payment.
- Attorney-review drafts exist for the Terms and liability waiver. Their substance is protected from UI-model edits and must be approved before ticket sales launch.

## Audience and moment

The purchaser is an adult choosing timed admission, often for a mixed party that may include other adults and minors. Immediately before payment, they need to understand what they are accepting, what applies only to themselves, and what other guests must complete before entry.

Primary anxieties: hidden conditions, accidentally accepting a waiver, losing checkout progress while reading a document, and uncertainty about minors or other adults.

## Authorized outcome

Add an explicit legal-consent section to the launched checkout order summary. Payment must remain disabled until the purchaser separately checks:

1. acceptance of the Terms of Use and Ticket Purchase Terms; and
2. voluntary acceptance of the Acknowledgment of Risk and Release of Liability for themselves, with a notice that other adults and a parent or legal guardian for each minor must complete their own waiver before entry.

The controls must start unchecked, use real checkboxes, expose clear focus states, link to `/terms` and `/liability-waiver`, and remain usable at 390px and by keyboard. Changing the order or starting a new order must clear assent.

## Design contract

- Build mode: hybrid; preserve the existing customer-specific checkout and add one native consent mechanic.
- Emotional job: informed confidence, not legal intimidation.
- Content density: two concise acknowledgments plus one short guest-responsibility note.
- Material world: the current paper-like, high-contrast Sky LA checkout; no modal chrome, glass, gradients, or generic SaaS cards.
- Motion grammar: none. State changes are immediate and rely on native focus/disabled feedback.
- Signature interaction: the payment control visibly unlocks only after both separate acknowledgments are checked.
- Accessibility: semantic `fieldset`/`legend`, 44px-or-larger hit areas, links distinguishable without color alone, keyboard-visible focus, no prechecked state, disabled CTA explained in nearby text.

## Falsifiable design hypothesis

For adult ticket purchasers, two separate unchecked acknowledgments placed directly above the payment CTA should improve informed completion and reduce accidental assent because the legal decision stays in the order context, each obligation is distinguishable, and payment cannot begin until both are affirmed.

## Page-physics contract

- Topology: existing linear checkout with a visit form and order-summary rail.
- Navigation: legal documents open in a separate tab so the in-progress order stays intact; link copy must disclose that behavior accessibly.
- Scroll: native document scroll only; no modal, nested legal scroller, sticky obstruction, or scroll-jacking.
- Interaction metaphor: final checklist before handing the order to the hosted payment provider.
- Motion: none; check/uncheck and disabled/enabled feedback are instantaneous.
- Mobile transformation: the order summary and consent block stack after visit details; labels wrap naturally without horizontal overflow.

## Colorless structural fingerprint

```text
Checkout
  Visit details
  Order summary
    Line items and total
    Stored order reference
    Legal consent fieldset
      Terms checkbox + document link
      Waiver checkbox + document link
      Other-adults/minors note
      Readiness explanation
    Review order
    Continue to card payment
    New order
```

This is an additive checkout mechanic, not a new page anatomy. It must not introduce a modal, a second summary card, a wizard stepper, or a repeated marketing section.

## Rollback

Revert the checkout component and checkout stylesheet changes. Server enforcement will be implemented independently and must not be weakened by UI rollback.
