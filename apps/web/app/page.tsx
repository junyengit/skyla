import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CalendarDays, MapPin, ShieldCheck, Sparkles } from "@skyla/ui/icons";
import { siteConfig, ticketPackages } from "@skyla/config";
import { MotionHero } from "@/components/motion-hero";

const views = [
  { src: "/images/view-academy.jpg", label: "Academy Museum" },
  { src: "/images/view-hills.jpg", label: "Hollywood Hills" },
  { src: "/images/view-westside.jpg", label: "Westside skyline" }
];

export default function HomePage() {
  return (
    <main>
      <nav className="nav" aria-label="Primary navigation">
        <Link className="brand" href="/">
          Sky LA
        </Link>
        <div className="navLinks">
          <a href="#experience">Experience</a>
          <Link href="/cafe">Cafe</Link>
          <Link href="/experiences">Events</Link>
          <a href="#visit">Visit</a>
        </div>
        <Link className="navCta" href="/checkout">
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
            Los Angeles
            <span>Above It All</span>
          </h1>
          <p className="heroCopy">
            Step into a top-floor lounge with 360-degree city views, timed deck
            access, private rooms, cafe service, and a calmer way to take in Los
            Angeles from above Wilshire.
          </p>
          <div className="heroActions">
            <Link className="primaryAction" href="/checkout">
              Buy Tickets
              <ArrowRight size={18} />
            </Link>
            <Link className="secondaryAction" href="/members">
              Membership
            </Link>
          </div>
        </MotionHero>
      </section>

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
              <strong>${ticket.price}</strong>
              <p>{ticket.description}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="footer" id="visit">
        <span>Sky LA</span>
        <p>{siteConfig.address.full}</p>
        <div className="footerLinks">
          <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </div>
      </footer>
    </main>
  );
}
