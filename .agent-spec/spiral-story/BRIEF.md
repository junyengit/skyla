# Sky LA spiral story brief

## Ground truth

Sky LA is a pre-launch observation deck on the top floor of 6100 Wilshire. The public promise is a 360-degree Los Angeles view, an indoor lounge, timed entry after launch, and planned launch pricing of $20 per adult. Ticket sales must remain disabled while `siteConfig.launched` is false.

## Audience and job

The primary visitor is deciding whether this place feels worth remembering for a date, a visitor itinerary, or a distinctly Los Angeles outing. They need spatial proof and atmosphere before operational detail. Mobile remains a first-class browsing context.

## Design hypothesis

For prospective Sky LA visitors, a native-scroll helix of real venue photography around a stable, legible narrative core should make the height, panorama, and sense of ascent more memorable than a conventional gallery because the motion models the experience of climbing toward a 360-degree view.

## Constraints

- Bespoke mode; existing customer photography only.
- Preserve the coming-soon banner, launch gate, navigation, operating-status truth, legal links, and checkout behavior.
- No scroll hijacking, new motion dependency, WebGL, generated assets, or hidden essential content.
- All core information is visible in the server-rendered document.
- Desktop may use a sticky spatial stage; mobile and reduced-motion modes use a linear editorial sequence.
- Motion uses transform and opacity only, with reserved image dimensions and no cumulative layout shift.

## Content inventory

- 360-degree city views: Century City, Museum Row, Hollywood Hills.
- Indoor lounge and floor-to-ceiling glass.
- Observation deck, timed entry, planned pricing, location, opening status.
- Existing licensed/customer-owned assets in `apps/web/public/images`.
