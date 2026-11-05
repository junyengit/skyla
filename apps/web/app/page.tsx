import Image from "next/image";
import Link from "next/link";
import { ArrowRight, MapPin } from "@skyla/ui/icons";
import { siteConfig } from "@skyla/config";
import { LaunchStatusBanner } from "@/components/launch-status-banner";
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
          Full-venue booking inquiries are open now. Individual tickets are not
          available; public hours will be announced separately.
          <br />
          <br />
          Request the full venue:{" "}
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

  return (
    <main className={siteConfig.launched ? undefined : "prelaunch"}>
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
        <a className="navCta" href="#book-venue">
          Full venue booking
        </a>
      </nav>
      <LaunchStatusBanner />

      <section className="hero">
        <div className="heroMedia" aria-hidden="true">
          <Image
            src="/images/view.jpg"
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
          <h1>Los Angeles, from the top of Wilshire.</h1>
          <p className="heroCopy">
            An observation deck on the top floor of 6100 Wilshire, with
            360-degree views from the Hollywood Hills to the Westside.
          </p>
          <div className="heroTicket">
            <span className="heroPrice">Full venue</span>
            <span className="heroPriceMeta">
              Exclusive use of the top floor
              <em>Individual tickets are not available</em>
            </span>
          </div>
          <div className="heroActions">
            <a className="primaryAction" href={`mailto:${siteConfig.email}`}>
              Request the full venue
              <ArrowRight size={18} />
            </a>
          </div>
        </MotionHero>
      </section>

      <div id="main-content" />

      <section
        className="ticketStatement"
        id="book-venue"
        aria-label="What a full venue booking includes"
      >
        <p className="sectionLabel">Exclusive booking</p>
        <h2>One booking, the whole skyline.</h2>
        <p className="ticketStatementCopy">
          Sky LA is currently available only as a full-venue booking. Exclusive
          use includes the open observation deck, the indoor lounge behind
          floor-to-ceiling glass, and views that run from the Hollywood Hills
          to the ocean. Individual admission is not available.
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
            <strong>Complete top floor</strong>
            <span>No shared admission or separate party alongside yours</span>
          </li>
        </ul>
      </section>

      <section className="viewsGallery" aria-label="Views from the deck">
        <figure className="viewsGalleryLead">
          <div className="viewsGalleryFrame">
            <Image
              src="/images/view-hills.jpg"
              alt="Residential blocks stretching west toward the Century City skyline"
              fill
              sizes="(max-width: 820px) 100vw, 62vw"
            />
          </div>
          <figcaption>Toward Century City</figcaption>
        </figure>
        <figure>
          <div className="viewsGalleryFrame">
            <Image
              src="/images/view-academy.jpg"
              alt="Academy Museum and Museum Row seen from above"
              fill
              sizes="(max-width: 820px) 100vw, 38vw"
            />
          </div>
          <figcaption>Academy Museum</figcaption>
        </figure>
        <figure>
          <div className="viewsGalleryFrame">
            <Image
              src="/images/view-westside.jpg"
              alt="Rooftops running north to the Hollywood Hills"
              fill
              sizes="(max-width: 820px) 100vw, 38vw"
            />
          </div>
          <figcaption>Hollywood Hills</figcaption>
        </figure>
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

      <section className="dateNight" aria-label="Full venue booking">
        <p className="sectionLabel">Currently available</p>
        <h2>Full venue bookings only</h2>
        <p className="dateNightCopy">
          Reserve the observation deck, indoor lounge, and complete top floor
          together for one private event.
        </p>
        <a className="inlineLink" href={`mailto:${siteConfig.email}`}>
          Request availability at {siteConfig.email}
        </a>
      </section>

      <PublicFooter />
    </main>
  );
}
