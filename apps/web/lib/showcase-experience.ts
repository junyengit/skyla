export const showcaseChapters = [
  {
    image: "03-gallery-hall",
    focus: "50% 42%",
    grade: { brightness: 0.92, contrast: 1.06, saturation: 0.86, sepia: 0.02 },
    kicker: "Sky Deck LA",
    title: "The gallery hall.",
    copy: "Sky LA is currently available exclusively for full-venue bookings at 6100 Wilshire.",
    cta: "Request the full venue"
  },
  {
    image: "01-arrival-tower",
    focus: "38% 42%",
    grade: { brightness: 0.88, contrast: 1.08, saturation: 0.8, sepia: 0.12 },
    kicker: "Museum Row",
    title: "Sixteen floors above Wilshire.",
    copy: "A private top-floor setting with the Los Angeles basin stretching out below."
  },
  {
    image: "04-deck-dusk",
    focus: "52% 50%",
    grade: { brightness: 0.94, contrast: 1.1, saturation: 0.88, sepia: 0.06 },
    kicker: "The deck",
    title: "The city at dusk.",
    copy: "The full observation deck is included in every current booking—never split between separate parties."
  },
  {
    image: "07-lounge-bar",
    focus: "58% 50%",
    grade: { brightness: 0.92, contrast: 1.08, saturation: 0.88, sepia: 0.04 },
    kicker: "The lounge",
    title: "Inside, behind the glass.",
    copy: "The indoor lounge and open deck are reserved together as one complete venue."
  },
  {
    image: "08-suite",
    focus: "52% 48%",
    grade: { brightness: 0.98, contrast: 1.06, saturation: 0.84, sepia: 0.03 },
    kicker: "One private booking",
    title: "The whole top floor.",
    copy: "There are no individual tickets, shared admissions, or partial-space reservations available now."
  },
  {
    image: "05-deck-night",
    focus: "50% 50%",
    grade: { brightness: 0.94, contrast: 1.08, saturation: 0.84, sepia: 0.05 },
    kicker: "After dark",
    title: "Los Angeles does the rest.",
    copy: "Tell us about your date, guest count, and event. We will reply with full-venue availability."
  },
  {
    image: "12-finale-city",
    focus: "50% 44%",
    grade: { brightness: 0.92, contrast: 1.1, saturation: 0.84, sepia: 0.06 },
    kicker: "Full venue bookings",
    title: "Take the whole view.",
    copy: "Exclusive use is the only way to book Sky LA right now.",
    cta: "Ask about availability"
  }
] as const;

export type ShowcaseChapter = (typeof showcaseChapters)[number];

export const showcaseFrameSrc = (image: string, mobile: boolean) =>
  `/showcase/${mobile ? "frames-m" : "frames"}/${image}.jpg`;
