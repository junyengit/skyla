import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CalendarDays, MapPin, ShieldCheck, Sparkles } from "@skyla/ui/icons";
import { siteConfig, ticketPackages } from "@skyla/config";
import { MobileNav } from "@/components/mobile-nav";
import { MotionHero } from "@/components/motion-hero";
import { publicNavItems } from "@/components/public-page-shell";
import {
  formatOperatingDay,
  operatingWeekdays,
  type PublicOperatingConfig
} from "@/lib/operating-hours";
import { loadPublicOperatingConfig } from "@/lib/public-operating-config";

export const dynamic = "force-dynamic";

const views = [
  { src: "/images/view-academy.jpg", label: "Academy Museum" },
  { src: "/images/view-hills.jpg", label: "Hollywood Hills" },
  { src: "/images/view-westside.jpg", label: "Westside skyline" }
];

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2
  }).format(cents / 100);
}

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
        <MobileNav items={publicNavItems.map((item) => ({ label: item.label, href: item.href }))} />
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
            Los Angeles{" "}
            <span>Above It All</span>
          </h1>
          <p className="heroCopy">
            Step into a top-floor lounge with 360-degree city views, timed deck
            access, private rooms, cafe service, and a calmer way to take in Los
            Angeles from above Wilshire.
          </p>
          <div className="heroActions">
            <Link className="primaryAction" href="/checkout" prefetch={false}>
              Buy Tickets
              <ArrowRight size={18} />
            </Link>
            <Link className="secondaryAction" href="/members" prefetch={false}>
              Membership
            </Link>
          </div>
        </MotionHero>
      </section>

      <div id="main-content" />
      <VisitorOperatingConfig config={operatingConfig} />

      <section className="section intro" id="experience">
        <div>
          <p className="sectionLabel">Observation lounge</p>
          <h2>A cinematic room for the city in every direction.</h2>
        </div>
        <p>
          Sky LA pairs open-air skyline moments with an indoor lounge, cafe
          service, and intimate rooms for dates, families, teams, and private
          celebrations above Museum Row.
        </p>
      </section>

      <section className="featureGrid" id="architecture">
        <article>
          <Sparkles size={24} />
          <h3>Rooftop views</h3>
          <p>
            Timed visits include observation deck access, indoor lounge seating,
            and skyline views from the Hollywood Hills to Downtown.
          </p>
        </article>
        <article>
          <ShieldCheck size={24} />
          <h3>Hosted entry</h3>
          <p>
            Ticketed arrival windows help keep the room composed, comfortable,
            and easy for staff to welcome guests with care.
          </p>
        </article>
        <article>
          <CalendarDays size={24} />
          <h3>Private moments</h3>
          <p>
            Reserve premium experiences, member gatherings, and private rooms
            when the occasion calls for a quieter corner above the city.
          </p>
        </article>
      </section>

      <section className="views" aria-label="Sky LA views">
        {views.map((view) => (
          <figure key={view.src}>
            <Image src={view.src} alt={view.label} width={520} height={360} />
            <figcaption>{view.label}</figcaption>
          </figure>
        ))}
      </section>

      <section className="tickets" id="tickets">
        <div>
          <p className="sectionLabel">Tickets</p>
          <h2>Choose the visit that fits the afternoon.</h2>
        </div>
        <div className="ticketList">
          {ticketPackages.map((ticket) => (
            <article key={ticket.key}>
              <span>{ticket.name}</span>
              <strong>{money(ticket.priceCents)}</strong>
              <p>{ticket.description}</p>
              <Link
                className="ticketCardLink"
                href={`/checkout?package=${ticket.key}`}
                prefetch={false}
              >
                Book {ticket.name}
                <ArrowRight size={16} />
              </Link>
            </article>
          ))}
        </div>
      </section>

      <footer className="footer" id="visit">
        <span>Sky LA</span>
        <p>{siteConfig.address.full}</p>
        <div className="footerLinks">
          <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>
          <Link href="/privacy" prefetch={false}>Privacy</Link>
          <Link href="/terms" prefetch={false}>Terms</Link>
        </div>
      </footer>
    </main>
  );
}
