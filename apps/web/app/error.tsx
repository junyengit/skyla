"use client";

import { useEffect } from "react";
import Link from "next/link";
import { siteConfig } from "@skyla/config";
import { LaunchStatusBanner } from "@/components/launch-status-banner";
import { reportClientError } from "@/lib/client-error-reporting";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

// Route-level React error boundary. Copy stays customer-safe: no framework,
// provider, or internal error detail is rendered.
export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    reportClientError(error, "error-boundary");
  }, [error]);

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

      <section className="section intro notFound" aria-labelledby="error-title">
        <div>
          <p className="sectionLabel">Something went wrong</p>
          <h2 id="error-title">This page hit unexpected turbulence.</h2>
        </div>
        <p>
          Please try again. If it keeps happening, email {siteConfig.email} and
          we will help with your visit.
          <br />
          <br />
          <button className="primaryAction" type="button" onClick={reset}>
            Try again
          </button>
        </p>
      </section>
    </main>
  );
}
