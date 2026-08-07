# Wilshire Spiral Staircase page-physics contract

## Topology

The hero opens into a long sculptural document. A connective rail descends through seven full-width levels. Each level is a real document section with one photographic or typographic landing positioned around the rail; nothing orbits a fixed center and nothing is held inside a single pinned viewport.

## Navigation

The existing fixed primary navigation and skip link remain native. Anchors, history, keyboard focus, browser find, and normal document scrolling are not intercepted.

## Scroll behavior

Desktop uses native vertical scroll. Overall story progress draws the rail farther down the document. Each level maps only its local viewport progress to a short settling motion, as if the next stair is being placed. There is no sticky stage, smooth-scroll engine, wheel handler, snap point, or forced progress.

## Interaction metaphor

The visitor descends through a spiral staircase being luxuriously assembled: a rail draws down, a landing settles, its bright lettering types across an already-readable title, and the next curve continues below.

## Motion grammar

- Rail motion: one SVG path-length draw tied directly to whole-story scroll progress.
- Landing motion: small translate, rotate, and scale changes that settle to rest; opacity stays at 1.
- Type motion: the complete title is always visible in a quiet base layer while a brighter duplicate types over it character by character.
- No global reveal preset, no content begins hidden, and no motion is required to understand the page.
- Hidden-tab resume and fast scrolling derive from scroll progress; typing timers are decorative and self-cleaning.

## Mobile transformation

At 820px and below, every landing becomes a single-column sequence, the rail moves to the left edge, and all settlement transforms are disabled. The bright title renders complete without typing.

## Reduced motion

`prefers-reduced-motion: reduce` keeps the full descending document, renders the complete bright title immediately, displays the entire rail, and removes settlement transforms and caret animation.

## Structural fingerprint

Full-bleed destination hero → quiet chapter threshold → seven asymmetrical full-page landings connected by a drawn descending rail → linear hours/location band → restrained date-night closer → footer. Colorless and copyless, the silhouette reads as a widening and narrowing stair stack rather than a gallery, carousel, or two-column marketing page.
