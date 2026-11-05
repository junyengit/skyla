# Reference map

## Current artifact

- Live checkout captured 2026-08-06: `https://skydeckla.com/checkout`
- Current state is intentionally pre-launch and contains no booking or payment controls.

## Interaction-adjacent evidence

- Lazyweb hosted report, 2026-08-06: `https://www.lazyweb.com/report/lazyweb/86dd80eb-6f3a-4bc8-aaaf-c6e993af1b84/?source=create`
  - Applicable principle: use an explicit unchecked control and block continuation until acceptance.
  - Not applicable: do not copy the report's visual styling or turn the checkout into another company's modal anatomy.
- ESG Book terms dialog reference returned by Lazyweb, 2026-08-06.
  - Applicable principle: checkbox state and Continue state communicate legal readiness.
  - Not applicable: modal presentation is rejected for this checkout.
- Walmart consent modal references returned by Lazyweb, 2026-08-06.
  - Applicable principle: legal consent must be unavoidable before the governed action.
  - Not applicable: broad shopping interruption and modal framing do not fit a focused ticket order summary.

## Source-of-truth copy

Use the recommended checkout consent wording in `docs/legal/launch-readiness-checklist.md`. Do not edit the attorney-review drafts or invent broader legal claims.
