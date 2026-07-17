import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { siteConfig } from "@skyla/config";
import { ArrowLink, PublicHero, PublicPageShell } from "@/components/public-page-shell";

export const metadata: Metadata = {
  title: "The Space",
  description:
    "Explore Sky LA's penthouse observation space, 360-degree views, 20-foot ceilings, floor-to-ceiling glass, and outdoor patios.",
  openGraph: {
    title: "The Space | Sky LA",
    description:
      "Explore Sky LA's penthouse observation space, 360-degree views, 20-foot ceilings, floor-to-ceiling glass, and outdoor patios."
  }
};

const stats = [
  ["360-degree", "Panoramic views"],
  ["20 ft", "Soaring ceilings"],
  ["2", "Outdoor patios"],
  ["Full glass", "Floor-to-ceiling perimeter"]
];

const features = [
  {
    eyebrow: "Feature 01",
    title: "360-degree views of Los Angeles",
    image: "/images/view-academy.jpg",
    imageAlt: "Academy Museum and Miracle Mile from Sky LA",
    body: [
      "Look north to the Hollywood Hills, east to the Downtown skyline, south across the city grid, and west toward Century City.",
      "On clear days, visibility stretches from the San Gabriel Mountains across the basin to the Westside."
    ],
    highlights: ["Hollywood Hills", "Downtown LA skyline", "Miracle Mile", "Century City", "San Gabriel Mountains"]
  },
  {
    eyebrow: "Feature 02",
    title: "A penthouse room with real volume",
    image: "/images/view.jpg",
    imageAlt: "Sky LA lounge with tall windows and city views",
    body: [
      "The 20-foot penthouse ceiling makes the room feel open before the view even appears.",
      "Natural light carries through the lounge from morning clarity into golden hour."
    ],
    highlights: ["Double-height volume", "Open arrival moment", "Light-filled lounge", "Architectural ceiling detail"]
  },
  {
    eyebrow: "Feature 03",
    title: "Floor-to-ceiling glass from every seat",
    image: "/images/lounge-window.webp",
    imageAlt: "Floor-to-ceiling windows at Sky LA",
    body: [
      "The curtain-glass perimeter wraps the floor in uninterrupted views with no awkward corners or blocked sightlines.",
      "Whether seated in the lounge or standing near the glass, the city stays present."
    ],
    highlights: ["Full glass perimeter", "Views from every seat", "Indoor-outdoor sightlines", "Comfortable lounge seating"]
  },
  {
    eyebrow: "Feature 04",
    title: "Two patios for open-air skyline moments",
    image: "/images/building.jpg",
    imageAlt: "6100 Wilshire building exterior",
    body: [
      "The East Patio faces the Downtown skyline and morning light.",
      "The West Patio catches sunset as it drops behind Century City and the Westside."
    ],
    highlights: ["East Patio", "West Patio", "Sunset views", "Open-air deck access"]
  }
];

const overview = [
  "Timed visits keep arrivals composed and comfortable.",
  "The indoor lounge gives guests a place to settle between deck moments.",
  "Cafe service keeps the visit relaxed instead of rushed.",
  "Step-free elevator access keeps the primary guest flow accessible."
];

export default function AboutPage() {
  return (
    <PublicPageShell active="about">
      <PublicHero
        eyebrow={siteConfig.address.short}
        title="The Space"
        copy="An architectural statement above the heart of Los Angeles, designed for people who want more than a view."
        image="/images/hero-lounge.jpg"
        imageAlt="Sky LA lounge above Los Angeles"
        actions={<ArrowLink href="/checkout">Reserve Your Spot</ArrowLink>}
      />

      <section className="publicStats" aria-label="Space highlights">
        {stats.map(([value, label]) => (
          <div key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </section>

      <section className="publicIntro">
        <div>
          <p className="sectionLabel">The space</p>
          <h2>A cinematic room for seeing the city in every direction.</h2>
        </div>
        <p>
          Sky LA pairs a top-floor observation deck with a composed indoor
          lounge, two open-air patios, cafe service, and room to slow down above
          Wilshire.
        </p>
      </section>

      <section className="publicFeatureList">
        {features.map((feature, index) => (
          <article className="publicFeature" key={feature.title}>
            <div className="publicFeatureMedia">
              <Image
                src={feature.image}
                alt={feature.imageAlt}
                width={720}
                height={520}
                sizes="(max-width: 820px) 100vw, 50vw"
              />
            </div>
            <div className="publicFeatureCopy">
              <p className="sectionLabel">{feature.eyebrow}</p>
              <h2>{feature.title}</h2>
              {feature.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              <div className="publicPillList">
                {feature.highlights.map((highlight) => (
                  <span key={highlight}>{highlight}</span>
                ))}
              </div>
              {index === 0 ? (
                <Link className="secondaryAction" href="/cafe" prefetch={false}>
                  See Cafe
                </Link>
              ) : null}
            </div>
          </article>
        ))}
      </section>

      <section className="publicCardBand">
        <div className="publicBandHeader">
          <p className="sectionLabel">At a glance</p>
          <h2>Everything the visit needs, without clutter.</h2>
        </div>
        <div className="publicCardGrid">
          {overview.map((item) => (
            <article key={item}>
              <p>{item}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="publicCta">
        <div>
          <p className="sectionLabel">Tickets</p>
          <h2>Ready to see it from the top floor?</h2>
        </div>
        <ArrowLink href="/checkout">Get Tickets</ArrowLink>
      </section>
    </PublicPageShell>
  );
}
