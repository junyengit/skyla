import Image from "next/image";
import Link from "next/link";
import { siteConfig } from "@skyla/config";
import { LaunchStatusBanner } from "@/components/launch-status-banner";
import { LocalBusinessJsonLd } from "@/components/local-business-jsonld";
import { MarketingScripts } from "@/components/marketing-scripts";
import { PublicFooter, publicNavItems } from "@/components/public-page-shell";
import { SkyFooterSign } from "@/components/sky-footer-sign";
import { SkyJourney } from "@/components/sky-journey";
import { SkyStageFilm } from "@/components/sky-stage-film";
import {
  formatOperatingDay,
  operatingWeekdayForInstant,
  operatingWeekdays,
  type PublicOperatingConfig
} from "@/lib/operating-hours";
import { loadPublicOperatingConfig } from "@/lib/public-operating-config";

export const dynamic = "force-dynamic";

const directionsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
  "6100 Wilshire Blvd, Los Angeles, CA 90048"
)}`;

// The journey film is a generated concept visualization of the venue; every
// claim in the copy below stays within the real offer.
const journeyChapters = [
  {
    title: "Los Angeles, from the top of Wilshire.",
    body: "An observation deck on the top floor of 6100 Wilshire, with 360-degree views from the Hollywood Hills to the Westside."
  },
  {
    title: "Above Museum Row.",
    body: "The deck rises over Wilshire's museum corridor, with the whole basin laid out below."
  },
  {
    title: "The top floor.",
    body: "An open observation deck and an indoor lounge behind floor-to-ceiling glass."
  }
];

const reelImages = [
  { src: "/images/view-hills.jpg", caption: "Toward Century City" },
  { src: "/images/view-academy.jpg", caption: "Academy Museum" },
  { src: "/images/view-westside.jpg", caption: "Hollywood Hills" },
  { src: "/images/hero-lounge.jpg", caption: "The lounge" },
  { src: "/images/lounge-window.webp", caption: "Behind the glass" },
  { src: "/images/bar.jpg", caption: "The bar" },
  { src: "/images/champagne-caviar.jpg", caption: "Champagne service" },
  { src: "/images/building.jpg", caption: "6100 Wilshire" }
];

export function OperatingHoursPanel({ config }: { config: PublicOperatingConfig }) {
  return (
    <section className="section intro" aria-label="Visitor information">
      <div>
        <p className="sectionLabel">{config.announcement ? "Guest notice" : "Plan your visit"}</p>
        <h2>Hours and updates.</h2>
      </div>
      <p>
        {config.announcement ? (
          <span data-announcement-type={config.announcement.type}>
            <strong role="status">{config.announcement.text}</strong>
            <br />
            <br />
          </span>
        ) : null}
        {operatingWeekdays.map((day, index) => (
          <span key={day}>
            <strong>{day}:</strong> {formatOperatingDay(config.operatingHours[day])}
            {index < operatingWeekdays.length - 1 ? <br /> : null}
          </span>
        ))}
      </p>
    </section>
  );
}

export function VisitorOperatingConfig({ config }: { config: PublicOperatingConfig | null }) {
  if (!config) return null;

  if (!siteConfig.launched) {
    return (
      <section className="section intro" aria-label="Visitor information">
        <div>
          <p className="sectionLabel">Plan your visit</p>
          <h2>Hours and updates.</h2>
        </div>
        <p>
          Sky LA is not open yet. Opening hours will be announced before launch.
          <br />
          <br />
          Questions about the opening:{" "}
          <a className="inlineLink" href={`mailto:${siteConfig.email}`}>
            {siteConfig.email}
          </a>
        </p>
      </section>
    );
  }

  return <OperatingHoursPanel config={config} />;
}

export default async function HomePage() {
  const operatingConfig = await loadPublicOperatingConfig();
  const currentWeekday = operatingConfig
    ? operatingWeekdayForInstant(new Date(), operatingConfig.timeZone)
    : null;
  const hoursLine =
    siteConfig.launched && operatingConfig && currentWeekday
      ? formatOperatingDay(operatingConfig.operatingHours[currentWeekday])
      : null;

  return (
    <main className={`skyNight${siteConfig.launched ? "" : " prelaunch"}`}>
      <LocalBusinessJsonLd config={operatingConfig} />
      <MarketingScripts />
      <a className="skipLink" href="#main-content">
        Skip to content
      </a>
      <nav className="nav" aria-label="Primary navigation">
        <Link className="brand" href="/">
          Sky LA
        </Link>
        <div className="navLinks">
          {publicNavItems.map((item) => (
            <Link key={item.key} href={item.href} prefetch={false}>
              {item.label}
            </Link>
          ))}
        </div>
        {siteConfig.launched ? (
          <Link className="navCta" href="/checkout" prefetch={false}>
            Buy Tickets
          </Link>
        ) : (
          <span className="navStatus">{siteConfig.launchStatus.label}</span>
        )}
      </nav>
      <LaunchStatusBanner />

      <SkyJourney chapters={journeyChapters} />

      <div id="main-content" />

      <SkyStageFilm hoursLine={hoursLine} />

      <section className="ticketStatement" aria-label="What your ticket includes">
        <p className="sectionLabel">One ticket</p>
        <h2>One ticket, the whole skyline.</h2>
        <p className="ticketStatementCopy">
          Admission covers the full top floor: the open observation deck, the
          indoor lounge behind floor-to-ceiling glass, and views that run from
          the Hollywood Hills to the ocean. Entry is timed, so the deck stays
          comfortable.
        </p>
        <ul className="ticketIncludes">
          <li>
            <strong>Observation deck</strong>
            <span>360-degree views above Wilshire, from the hills to the sea</span>
          </li>
          <li>
            <strong>Indoor lounge</strong>
            <span>Seating behind floor-to-ceiling glass</span>
          </li>
          <li>
            <strong>Timed entry</strong>
            <span>Choose your date and arrival window</span>
          </li>
        </ul>
      </section>

      <section className="skyReel" aria-label="Views and spaces">
        <div className="skyReel__track">
          {[...reelImages, ...reelImages].map((image, index) => (
            <figure aria-hidden={index >= reelImages.length} key={`${image.src}-${index}`}>
              <div className="skyReel__frame">
                <Image
                  alt={index < reelImages.length ? image.caption : ""}
                  fill
                  sizes="(max-width: 820px) 60vw, 26rem"
                  src={image.src}
                />
              </div>
              <figcaption>{image.caption}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <div className="visitBand" id="visit">
        <VisitorOperatingConfig config={operatingConfig} />

        <section className="section intro visitLocation" aria-label="Location">
          <div>
            <p className="sectionLabel">Find us</p>
            <h2>On Museum Row.</h2>
          </div>
          <div className="visitLocationBody">
            <p>
              {siteConfig.address.full}
              <br />
              <br />
              <a
                className="inlineLink"
                href={directionsUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Get Directions
              </a>
            </p>
            <figure className="visitPhoto">
              <Image
                src="/images/building.jpg"
                alt="The dark glass tower at 6100 Wilshire, on Museum Row"
                width={647}
                height={588}
              />
              <figcaption>6100 Wilshire, Museum Row</figcaption>
            </figure>
          </div>
        </section>
      </div>

      <section className="dateNight" aria-label="Date Night preview">
        <p className="sectionLabel">Coming soon</p>
        <h2>Date Night</h2>
        <p className="dateNightCopy">
          A reserved after-hours visit for two. $98 for two, entry included.
        </p>
        <a className="inlineLink" href={`mailto:${siteConfig.email}`}>
          Inquire at {siteConfig.email}
        </a>
      </section>

      <SkyFooterSign />
      <PublicFooter />
    </main>
  );
}
