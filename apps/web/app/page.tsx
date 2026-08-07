import Image from "next/image";
import Link from "next/link";
import { ArrowRight, MapPin } from "@skyla/ui/icons";
import { siteConfig } from "@skyla/config";
import { LaunchStatusBanner } from "@/components/launch-status-banner";
import { LocalBusinessJsonLd } from "@/components/local-business-jsonld";
import { MarketingScripts } from "@/components/marketing-scripts";
import { MotionHero } from "@/components/motion-hero";
import { PublicFooter, publicNavItems } from "@/components/public-page-shell";
import { SpiralStaircaseStory } from "@/components/spiral-story";
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
        {siteConfig.launched ? (
          <Link className="navCta" href="/checkout" prefetch={false}>
            Buy Tickets
          </Link>
        ) : (
          <span className="navStatus">{siteConfig.launchStatus.label}</span>
        )}
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
            <span className="heroPrice">$20</span>
            <span className="heroPriceMeta">
              {siteConfig.launched ? "all-in, per adult" : "planned launch pricing, per adult"}
              <em>Ages 12 and under $10</em>
            </span>
          </div>
          <div className="heroActions">
            {siteConfig.launched ? (
              <Link className="primaryAction" href="/checkout" prefetch={false}>
                Buy Tickets
                <ArrowRight size={18} />
              </Link>
            ) : (
              <a className="primaryAction" href={`mailto:${siteConfig.email}`}>
                Ask about opening
                <ArrowRight size={18} />
              </a>
            )}
          </div>
        </MotionHero>
      </section>

      <div id="main-content" />

      <SpiralStaircaseStory />

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

      <PublicFooter />
    </main>
  );
}
