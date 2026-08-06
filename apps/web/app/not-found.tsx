import Link from "next/link";
import { ArrowRight } from "@skyla/ui/icons";
import { siteConfig } from "@skyla/config";
import { LaunchStatusBanner } from "@/components/launch-status-banner";
import { PublicFooter } from "@/components/public-page-shell";

export default function NotFound() {
  return (
    <main className={siteConfig.launched ? "publicPage" : "publicPage prelaunch"}>
      <header className="publicNav">
        <Link className="brand" href="/">
          Sky LA
        </Link>
        <nav aria-label="Primary navigation" />
        {siteConfig.launched ? (
          <Link className="navCta" href="/checkout" prefetch={false}>
            Buy Tickets
          </Link>
        ) : (
          <span className="navStatus">{siteConfig.launchStatus.label}</span>
        )}
      </header>

      <LaunchStatusBanner />

      <section className="section intro notFound" aria-labelledby="not-found-title">
        <div>
          <p className="sectionLabel">404</p>
          <h2 id="not-found-title">This page is off the map.</h2>
        </div>
        <p>
          The page you were looking for does not exist or has moved. Head back to
          the lounge, or go straight to tickets.
          <br />
          <br />
          <Link className="primaryAction" href="/" prefetch={false}>
            Back to Sky LA
            <ArrowRight size={18} />
          </Link>
        </p>
      </section>

      <PublicFooter />
    </main>
  );
}
