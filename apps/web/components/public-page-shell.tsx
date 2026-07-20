import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { siteConfig } from "@skyla/config";
import { ArrowRight } from "@skyla/ui/icons";

type NavKey = "checkout";

type PublicPageShellProps = {
  active: NavKey;
  children: ReactNode;
};

// The simple-site pivot keeps one public destination: tickets. The header is
// brand + a single Buy CTA, so no hamburger menu is rendered.
export const publicNavItems: Array<{ key: NavKey; label: string; href: string }> = [
  { key: "checkout", label: "Tickets", href: "/checkout" }
];

export function PublicPageShell({ active, children }: PublicPageShellProps) {
  return (
    <main className="publicPage">
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
        <Link className="navCta" href="/checkout" prefetch={false}>
          Buy Tickets
        </Link>
      </header>

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
        <Link href="/checkout" prefetch={false}>
          Tickets
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
