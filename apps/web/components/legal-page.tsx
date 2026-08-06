import Link from "next/link";
import type { ReactNode } from "react";
import { siteConfig } from "@skyla/config";
import { LaunchStatusBanner } from "@/components/launch-status-banner";

type LegalSection = {
  title: string;
  body?: ReactNode;
  items?: ReactNode[];
};

type LegalPageProps = {
  title: string;
  updated: string;
  intro: ReactNode;
  sections: LegalSection[];
};

export function LegalPage({ title, updated, intro, sections }: LegalPageProps) {
  return (
    <main className={siteConfig.launched ? "legalPage" : "legalPage prelaunch"}>
      <header className="legalNav">
        <Link className="brand" href="/">
          Sky LA
        </Link>
        <nav aria-label="Legal page navigation">
          <Link href="/" prefetch={false}>
            Home
          </Link>
          <Link href="/checkout" prefetch={false}>
            Tickets
          </Link>
        </nav>
        {siteConfig.launched ? (
          <Link className="navCta" href="/checkout" prefetch={false}>
            Buy Tickets
          </Link>
        ) : (
          <span className="navStatus">{siteConfig.launchStatus.label}</span>
        )}
      </header>

      <LaunchStatusBanner />

      <article className="legalArticle">
        <p className="sectionLabel">Legal</p>
        <h1>{title}</h1>
        <p className="legalUpdated">Last updated: {updated}</p>
        <div className="legalIntro">{intro}</div>

        {sections.map((section) => (
          <section key={section.title} className="legalSection">
            <h2>{section.title}</h2>
            {section.body ? <div className="legalBody">{section.body}</div> : null}
            {section.items ? (
              <ul>
                {section.items.map((item, index) => (
                  <li key={`${section.title}-${index}`}>{item}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </article>

      <footer className="footer legalFooter">
        <span>Sky LA</span>
        <p>{siteConfig.address.full}</p>
        <div className="footerLinks">
          <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>
          <Link href="/privacy" prefetch={false}>
            Privacy
          </Link>
          <Link href="/terms" prefetch={false}>
            Terms
          </Link>
        </div>
      </footer>
    </main>
  );
}
