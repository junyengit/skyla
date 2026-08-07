# Kimi implementation task: Wilshire Helix

Implement the frozen brief and page-physics contract in this repository.

Primary scope:

- Replace the current pinned/orbiting Wilshire Helix implementation with a reusable client component whose document levels build downward like a spiral staircase.
- Reuse `motion/react`; add no dependency.
- Use only existing images in `apps/web/public/images`.
- Keep all essential copy server-visible and never hidden behind an entrance reveal.
- Use whole-story native `useScroll` progress to draw a descending connective rail and local per-level progress to settle each landing into place.
- Do not use sticky positioning for the story and do not orbit cards around a fixed center.
- Use a static linear layout for initial SSR, screens at or below 820px, and reduced-motion users.
- Keep each complete title visibly rendered in a quiet base layer, then type a brighter duplicate over it as a decorative emphasis.
- Preserve the launch banner, `siteConfig.launched` gate, marketing scripts, checkout routes, operating config, footer, and all non-home surfaces.
- Add focused tests for server-visible content, reduced-motion/mobile enhancement rules where practical, and the absence of scroll-hijacking handlers.
- Keep landing motion to transforms; content opacity must remain 1. Reserve image dimensions.

Validation:

- web lint
- web typecheck
- focused unit tests
- web production build

Return edited files, any deviations, and validation output.
