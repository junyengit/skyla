import type { Metadata } from "next";
import Link from "next/link";
import { listTicketPackages } from "@skyla/payments";
import { ArrowRight, MapPin, ShieldCheck } from "@skyla/ui/icons";
import { siteConfig } from "@skyla/config";
import { CheckoutClient } from "@/components/checkout-client";
import { LaunchStatusBanner } from "@/components/launch-status-banner";
import { loadPublicOperatingConfig } from "@/lib/public-operating-config";

export const dynamic = "force-dynamic";

const checkoutDescription = siteConfig.launched
  ? "Reserve The View at Sky LA. $20 all-in per adult, timed entry above Wilshire."
  : "Sky LA is coming soon. Ticket sales are not live; planned launch pricing is $20 all-in per adult.";

export const metadata: Metadata = {
  title: "Checkout",
  description: checkoutDescription,
  referrer: "no-referrer",
  openGraph: {
    title: "Checkout | Sky LA",
    description: checkoutDescription
  }
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function PreLaunchCheckout() {
  return (
    <main className="checkoutPage prelaunch" data-native-checkout="true">
      <nav className="nav checkoutNav" aria-label="Primary navigation">
        <Link className="brand" href="/">
          Sky LA
        </Link>
        <div className="navLinks">
          <Link href="/checkout" prefetch={false} aria-current="page">
            Tickets
          </Link>
        </div>
        <Link className="navCta" href="/">
          Home
        </Link>
      </nav>

      <LaunchStatusBanner />

      <section className="checkoutHero">
        <div className="checkoutEyebrow">
          <MapPin size={16} />
          {siteConfig.address.short}
        </div>
        <h1>Checkout</h1>
        <p>
          Sky LA is not open yet, so tickets cannot be purchased today. Planned
          launch pricing is $20 all-in per adult, with $10 entry for ages 12 and
          under.
        </p>
      </section>

      <section className="checkoutPrelaunch" aria-label="Ticket sales status">
        <div className="checkoutPanelHeader">
          <p className="checkoutPanelLabel">Ticket status</p>
          <h2>Ticket sales are not live.</h2>
        </div>
        <p className="checkoutPrelaunchCopy">
          There is nothing to book and no payment to make right now. Opening
          dates and entry times will be announced here before launch. For group
          visits, Date Night, or other questions, email the reservations team.
        </p>
        <a className="primaryAction" href={`mailto:${siteConfig.email}`}>
          Email {siteConfig.email}
          <ArrowRight size={18} />
        </a>
      </section>
    </main>
  );
}

export default async function CheckoutPage({ searchParams }: { searchParams: SearchParams }) {
  if (!siteConfig.launched) {
    return <PreLaunchCheckout />;
  }

  const [params, operatingConfig] = await Promise.all([searchParams, loadPublicOperatingConfig()]);
  const stripeStatus = firstParam(params.stripe);
  const checkoutSessionId = firstParam(params.session_id);
  const packageOptions = listTicketPackages()
    .map((ticket) => ({
      key: ticket.key,
      name: ticket.name,
      priceCents: ticket.priceCents
    }));

  return (
    <main className="checkoutPage" data-native-checkout="true">
      <nav className="nav checkoutNav" aria-label="Primary navigation">
        <Link className="brand" href="/">
          Sky LA
        </Link>
        <div className="navLinks">
          <Link href="/checkout" prefetch={false} aria-current="page">
            Tickets
          </Link>
        </div>
        <Link className="navCta" href="/">
          Home
        </Link>
      </nav>

      <section className="checkoutHero">
        <div className="checkoutEyebrow">
          <MapPin size={16} />
          {siteConfig.address.short}
        </div>
        <h1>Checkout</h1>
        <p>
          The View, $20 all-in per adult. Choose a date and entry time, then
          continue to secure hosted card payment.
        </p>
      </section>

      <CheckoutClient
        packages={packageOptions}
        stripeStatus={stripeStatus === "success" || stripeStatus === "cancel" ? stripeStatus : undefined}
        returnedCheckoutSessionId={checkoutSessionId}
        operatingHours={operatingConfig?.operatingHours ?? null}
        initialPackageKey={firstParam(params.package)}
      />

      <section className="checkoutTrust" aria-label="Checkout safeguards">
        <div>
          <ShieldCheck size={22} />
          <span>Prices verified before payment</span>
        </div>
        <div>
          <ArrowRight size={22} />
          <span>Secure hosted card payment</span>
        </div>
      </section>
    </main>
  );
}
