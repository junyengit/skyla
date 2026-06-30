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
          <a href="#tickets">Tickets</a>
          <a href="#visit">Visit</a>
        </div>
        <a className="navCta" href="#tickets">
          Buy Tickets
        </a>
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
            A quieter, sharper rebuild of Sky LA starts here: the public venue
            site, ticketing, POS, admin, payments, and data layer moving into a
            typed Next.js and Vercel architecture.
          </p>
          <div className="heroActions">
            <a className="primaryAction" href="#tickets">
              Plan a Visit
              <ArrowRight size={18} />
            </a>
            <a className="secondaryAction" href="#architecture">
              View Migration
            </a>
          </div>
        </MotionHero>
      </section>

      <section className="section intro" id="experience">
        <div>
          <p className="sectionLabel">Architecture in flight</p>
          <h2>A safer foundation without a risky big bang.</h2>
        </div>
        <p>
          The current GitHub Pages site stays intact while the Vercel app grows
          beside it. Pages, payments, and operations can be migrated slice by
          slice with preview deployments and rollback points.
        </p>
      </section>

      <section className="featureGrid" id="architecture">
        <article>
          <Sparkles size={24} />
          <h3>Next.js app router</h3>
          <p>
            Static marketing pages become typed server components with focused
            client islands for Motion, checkout, admin, and POS interactions.
          </p>
        </article>
        <article>
          <ShieldCheck size={24} />
          <h3>Server authority</h3>
          <p>
            Payment amounts, booking creation, POS actions, and webhooks move
            out of client trust and into server-side order flows.
          </p>
        </article>
        <article>
          <CalendarDays size={24} />
          <h3>Preview-first workflow</h3>
          <p>
            Vercel previews, GitHub checks, branch protection, and documented
            runbooks replace direct-to-production edits.
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
          <p className="sectionLabel">Ticket model</p>
          <h2>Canonical pricing is moving server-side.</h2>
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
        <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>
      </footer>
    </main>
  );
}
