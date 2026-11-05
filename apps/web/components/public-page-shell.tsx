import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { siteConfig } from "@skyla/config";
import { ArrowRight } from "@skyla/ui/icons";
import { LaunchStatusBanner } from "@/components/launch-status-banner";

type NavKey = "checkout";

type PublicPageShellProps = {
  active: NavKey;
  children: ReactNode;
};

// The public shell keeps one booking destination: an inquiry for the complete
// venue. Individual ticket sales are not offered.
export const publicNavItems: Array<{ key: NavKey; label: string; href: string }> = [
  { key: "checkout", label: "Full venue", href: "/#book-venue" }
];

export function PublicPageShell({ active, children }: PublicPageShellProps) {
  return (
    <main className={siteConfig.launched ? "publicPage" : "publicPage prelaunch"}>
      <a className="skipLink" href="#main-content">
        Skip to content
      </a>
      <header className="publicNav">
        <Link className="brand" href="/">
          Sky LA
        </Link>
        <nav aria-label="Primary navigation">
          {publicNavItems.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              prefetch={false}
              aria-current={active === item.key ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <a className="navCta" href={`mailto:${siteConfig.email}`}>
          Request availability
        </a>
      </header>

      <LaunchStatusBanner />

      <div id="main-content" />
      {children}

      <PublicFooter />
    </main>
  );
}

const directionsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
  "6100 Wilshire Blvd, Los Angeles, CA 90048"
)}`;

export function PublicFooter() {
  return (
    <footer className="footer publicFooter">
      <span>Sky LA</span>
      <p>{siteConfig.address.full}</p>
      <div className="footerLinks">
        <Link href="/#book-venue" prefetch={false}>
          Full venue booking
        </Link>
        <a href={directionsUrl} target="_blank" rel="noopener noreferrer">
          Get Directions
        </a>
        <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>
        <Link href="/privacy" prefetch={false}>
          Privacy
        </Link>
        <Link href="/terms" prefetch={false}>
          Terms
        </Link>
      </div>
    </footer>
  );
}

type PublicHeroProps = {
  eyebrow: string;
  title: ReactNode;
  copy: string;
  image: string | StaticImageData;
  imageAlt: string;
  actions?: ReactNode;
};

export function PublicHero({ eyebrow, title, copy, image, imageAlt, actions }: PublicHeroProps) {
  return (
    <section className="publicHero">
      <div className="publicHeroMedia" aria-hidden="true">
        <Image src={image} alt="" fill priority sizes="100vw" className="publicHeroImage" />
      </div>
      <div className="publicHeroShade" />
      <div className="publicHeroContent">
        <p className="sectionLabel">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{copy}</p>
        {actions ? <div className="publicHeroActions">{actions}</div> : null}
      </div>
      <span className="srOnly">{imageAlt}</span>
    </section>
  );
}

export function ArrowLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link className="primaryAction" href={href} prefetch={false}>
      {children}
      <ArrowRight size={18} />
    </Link>
  );
}
