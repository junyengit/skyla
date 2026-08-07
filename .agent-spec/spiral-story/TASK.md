# Kimi implementation task: Wilshire Helix

Implement the frozen brief and page-physics contract in this repository.

Primary scope:

- Replace the home page’s static `ticketStatement` and `viewsGallery` with a reusable client component for the Wilshire Helix chapter.
- Reuse `motion/react`; add no dependency.
- Use only existing images in `apps/web/public/images`.
- Keep all essential copy server-visible and never hidden behind an entrance reveal.
- Use native `useScroll` progress for desktop orbital transforms.
- Use a static linear layout for initial SSR, screens at or below 820px, and reduced-motion users.
- Add a decorative typed phrase tied to the active step; it must not be the sole rendering of essential information.
- Preserve the launch banner, `siteConfig.launched` gate, marketing scripts, checkout routes, operating config, footer, and all non-home surfaces.
- Add focused tests for server-visible content, reduced-motion/mobile enhancement rules where practical, and the absence of scroll-hijacking handlers.
- Keep card motion to transforms and opacity. Reserve image dimensions.

Validation:

- web lint
- web typecheck
- focused unit tests
- web production build

Return edited files, any deviations, and validation output.
