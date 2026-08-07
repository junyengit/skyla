# Wilshire Helix page-physics contract

## Topology

The hero remains a full-bleed entry plane. The next chapter is a layered cylindrical field: one stable narrative core, an elliptical stair trace, and five orbiting photo/fact steps. Operational sections return to a linear document after the spatial chapter.

## Navigation

The existing fixed primary navigation and skip link remain native. Anchors, history, keyboard focus, and browser find are not intercepted.

## Scroll behavior

Desktop uses native vertical scroll across a bounded long section. Its internal stage is sticky for the chapter only. Scroll progress maps cards along one-and-a-half turns of a helix; there is no smooth-scroll engine, wheel handler, snap point, or forced progress.

## Interaction metaphor

The user ascends an abstract spiral staircase around a calm observation point. Cards approach from below and the outer radius, pass a readable foreground position, then recede upward. Step numbering communicates progression without requiring interaction.

## Motion grammar

- Card motion: translate3d, rotate, scale, and bounded opacity.
- Ambient structure: slow counter-rotation of an elliptical stair trace.
- Typed accent: a decorative skyline phrase types when the active step changes; essential heading and explanation remain fully visible.
- No global reveal preset and no content starts at zero opacity.
- Hidden-tab resume and fast scrolling derive directly from scroll progress rather than accumulating time.

## Mobile transformation

At 820px and below, sticky positioning and orbital transforms are disabled. The exact same content becomes a single-column sequence of large photographs and bordered fact cards. The typed accent renders its complete phrase without animation.

## Reduced motion

`prefers-reduced-motion: reduce` uses the same linear sequence at every width, disables typing, and removes transform transitions.

## Structural fingerprint

Full-bleed destination hero → spatial helix chapter with centered observation core → linear hours/location band → restrained date-night closer → footer. Colorless, copyless comparison is unlike the repository’s existing static two-column statement and masonry gallery.
