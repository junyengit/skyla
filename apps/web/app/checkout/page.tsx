import type { Metadata } from "next";
import Link from "next/link";
import { admissionAgeCategories, admissionMaxPartySize, listTicketPackages } from "@skyla/payments";
import { ArrowRight, MapPin, ShieldCheck } from "@skyla/ui/icons";
import { siteConfig } from "@skyla/config";
import { CheckoutClient } from "@/components/checkout-client";
import { LaunchStatusBanner } from "@/components/launch-status-banner";
import { localAdmissionPreviewEnabled } from "@/lib/local-admission-preview";
import { loadPublicOperatingConfig } from "@/lib/public-operating-config";

export const dynamic = "force-dynamic";

const fullVenueBookingHref = "/#venue-booking";
const admissionRateSummary = Object.values(admissionAgeCategories)
  .map((category) => `${category.label} ${category.priceCents ? `$${category.priceCents / 100}` : "free"}`)
  .join(", ");

const checkoutDescription = siteConfig.launched
  ? "Reserve The View at Sky LA. Adults 18+ $20, ages 8–17 $10, ages 0–7 free. Timed entry above Wilshire."
  : "Online ticket purchasing is not enabled here yet. Contact us about normal visits or full-venue bookings.";

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
          <Link href={fullVenueBookingHref} prefetch={false}>
            Full venue booking
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
          Plan a normal visit or book the full venue.
        </p>
      </section>

      <section className="checkoutPrelaunch" aria-label="Ticket sales status">
        <div className="checkoutPanelHeader">
          <h2>Contact Sky LA</h2>
        </div>
        <p className="checkoutPrelaunchCopy">
          Contact the Sky LA team about normal visits. For exclusive use of the
          observation deck and indoor lounge, request full-venue availability.
        </p>
        <a
          className="primaryAction"
          href={`mailto:${siteConfig.email}?subject=${encodeURIComponent("Full venue booking inquiry")}`}
        >
          Request full-venue availability
          <ArrowRight size={18} />
        </a>
      </section>
    </main>
  );
}

function LocalAdmissionPreviewNotice() {
  return (
    <p className="checkoutPreviewNotice" role="note">
      Local preview only. Ticket sales are off, so no order or payment can be created.
    </p>
  );
}

export default async function CheckoutPage({ searchParams }: { searchParams: SearchParams }) {
  const localPreview = !siteConfig.launched && localAdmissionPreviewEnabled();
  if (!siteConfig.launched && !localPreview) {
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
      <nav className="nav checkoutNav checkoutNavWithLinks" aria-label="Primary navigation">
        <Link className="brand" href="/">
          Sky LA
        </Link>
        <div className="navLinks checkoutNavLinks">
          <Link className="checkoutNavCurrent" href="/checkout" prefetch={false} aria-current="page">
            Tickets
          </Link>
          <Link href={fullVenueBookingHref} prefetch={false}>
            Full venue booking
          </Link>
        </div>
        <Link className="navCta" href="/">
          Home
        </Link>
      </nav>

      {localPreview ? <LocalAdmissionPreviewNotice /> : null}

      <section className="checkoutHero">
        <h1>Checkout</h1>
        <p>
          {admissionRateSummary}. Up to {admissionMaxPartySize} visitors per
          order. No fees added at payment.
        </p>
        <p className="checkoutAddress">
          <MapPin size={16} />
          {siteConfig.address.short}
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
