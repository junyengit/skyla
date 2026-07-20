import Image from "next/image";
import Link from "next/link";
import { ArrowRight, MapPin } from "@skyla/ui/icons";
import { siteConfig } from "@skyla/config";
import { LocalBusinessJsonLd } from "@/components/local-business-jsonld";
import { MarketingScripts } from "@/components/marketing-scripts";
import { MotionHero } from "@/components/motion-hero";
import { PublicFooter, publicNavItems } from "@/components/public-page-shell";
import {
  formatOperatingDay,
  operatingWeekdays,
  type PublicOperatingConfig
} from "@/lib/operating-hours";
import { loadPublicOperatingConfig } from "@/lib/public-operating-config";

export const dynamic = "force-dynamic";

const directionsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
  "6100 Wilshire Blvd, Los Angeles, CA 90048"
)}`;

export function VisitorOperatingConfig({ config }: { config: PublicOperatingConfig | null }) {
  if (!config) return null;

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

export default async function HomePage() {
  const operatingConfig = await loadPublicOperatingConfig();

  return (
    <main>
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
        <Link className="navCta" href="/checkout" prefetch={false}>
          Buy Tickets
        </Link>
      </nav>

      <section className="hero">
        <div className="heroMedia" aria-hidden="true">
          <Image
            src="/images/hero-lounge.jpg"
            alt=""
            fill
            priority
            sizes="100vw"
            className="heroImage"
          />
        </div>
        <div className="heroScrim" />
        <MotionHero>
          <p className="location">
            <MapPin size={16} />
            {siteConfig.address.short}
          </p>
          <h1>
            Los Angeles <span>above it all</span>
          </h1>
          <p className="heroCopy">
            An observation deck and lounge on the top floor of 6100 Wilshire,
            timed to the light.
          </p>
          <div className="heroTicket">
            <span className="heroPrice">$20</span>
            <span className="heroPriceMeta">
              all-in, per adult
              <em>Ages 12 and under $10</em>
            </span>
          </div>
          <div className="heroActions">
            <Link className="primaryAction" href="/checkout" prefetch={false}>
              Buy Tickets
              <ArrowRight size={18} />
            </Link>
          </div>
        </MotionHero>
      </section>

      <div id="main-content" />

      <section className="ticketStatement" aria-label="What your ticket includes">
        <p className="sectionLabel">One ticket. The View.</p>
        <h2>
          The whole city, <span>in one quiet room.</span>
        </h2>
        <p className="ticketStatementCopy">
          Your ticket is the top floor: the open observation deck, the indoor
          lounge behind floor-to-ceiling glass, and a skyline that runs from the
          Hollywood Hills to the ocean haze. Entry is timed, so the room stays
          calm and the glass stays yours.
        </p>
        <ul className="ticketIncludes">
          <li>
            <strong>Observation deck</strong>
            <span>360-degree views above Wilshire, hills to sea</span>
          </li>
          <li>
            <strong>Indoor lounge</strong>
            <span>Seated comfort behind floor-to-ceiling glass</span>
          </li>
          <li>
            <strong>Timed entry</strong>
            <span>Choose your date and arrival window</span>
          </li>
        </ul>
      </section>

      <section className="viewsGallery" aria-label="Views from the deck">
        <figure className="viewsGalleryLead">
          <Image
            src="/images/view-hills.jpg"
            alt="Hollywood Hills and the westside skyline from the Sky LA deck"
            fill
            sizes="(max-width: 820px) 100vw, 62vw"
          />
          <figcaption>Hollywood Hills</figcaption>
        </figure>
        <figure>
          <Image
            src="/images/view-academy.jpg"
            alt="Academy Museum and Museum Row seen from above"
            fill
            sizes="(max-width: 820px) 100vw, 38vw"
          />
          <figcaption>Academy Museum</figcaption>
        </figure>
        <figure>
          <Image
            src="/images/view-westside.jpg"
            alt="Westside rooftops stretching toward Century City"
            fill
            sizes="(max-width: 820px) 100vw, 38vw"
          />
          <figcaption>Westside skyline</figcaption>
        </figure>
      </section>

      <div className="visitBand" id="visit">
        <VisitorOperatingConfig config={operatingConfig} />

        <section className="section intro visitLocation" aria-label="Location">
          <div>
            <p className="sectionLabel">Find us</p>
            <h2>On Museum Row.</h2>
          </div>
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
        </section>
      </div>

      <section className="dateNight" aria-label="Date Night preview">
        <p className="sectionLabel">Coming soon</p>
        <h2>Date Night</h2>
        <p className="dateNightCopy">
          A reserved evening for two above the city lights. $98 for two, entry
          included.
        </p>
        <a className="inlineLink" href={`mailto:${siteConfig.email}`}>
          Inquire at {siteConfig.email}
        </a>
      </section>

      <PublicFooter />
    </main>
  );
}
