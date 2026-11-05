import Link from "next/link";
import { siteConfig } from "@skyla/config";
import { LocalBusinessJsonLd } from "@/components/local-business-jsonld";
import { MarketingScripts } from "@/components/marketing-scripts";
import { ShowcaseWalkthrough } from "@/components/showcase-walkthrough";
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
  const bookingEmail = `mailto:${siteConfig.email}?subject=${encodeURIComponent("Full venue booking inquiry")}`;

  return (
    <main className="skyShowcase">
      <LocalBusinessJsonLd config={operatingConfig} />
      <MarketingScripts />
      <a className="skipLink" href="#main-content">
        Skip to content
      </a>
      <header className="showcaseHeader">
        <Link className="showcaseBrand" href="/">
          Sky<em> ◆ </em>Deck LA
        </Link>
        <a className="showcaseButton isSolid" href="#book-venue">
          Full venue booking
        </a>
      </header>

      <ShowcaseWalkthrough />

      <div id="main-content" />

      <section className="venueBooking" id="book-venue" aria-labelledby="venue-booking-title">
        <div>
          <p className="venueBookingLabel">Currently available</p>
          <h2 id="venue-booking-title">The full venue. One private booking.</h2>
          <p className="venueBookingLead">
            <strong>Individual tickets are not available.</strong> Sky LA is currently
            accepting inquiries only for exclusive use of the full venue: the
            observation deck and indoor lounge together.
          </p>
        </div>
        <div className="venueBookingAside">
          <p>
            <strong>Tell us about your event</strong>
            Share your preferred date, estimated guest count, and what you are planning.
          </p>
          <a className="showcaseButton isSolid" href={bookingEmail}>
            Request availability
          </a>
          <p>
            <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>
          </p>
        </div>
      </section>

      <footer className="showcaseFooter">
        <span>Sky Deck LA · {siteConfig.address.full}</span>
        <span>
          <a href={directionsUrl} target="_blank" rel="noopener noreferrer">Directions</a>
          {" · "}
          <Link href="/privacy" prefetch={false}>Privacy</Link>
          {" · "}
          <Link href="/terms" prefetch={false}>Terms</Link>
        </span>
      </footer>
    </main>
  );
}
