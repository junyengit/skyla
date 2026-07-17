import type { Metadata } from "next";
import Link from "next/link";
import { listAddons, listTicketPackages } from "@skyla/payments";
import { ArrowRight, MapPin, ShieldCheck } from "@skyla/ui/icons";
import { siteConfig } from "@skyla/config";
import { CheckoutClient } from "@/components/checkout-client";
import { loadPublicOperatingConfig } from "@/lib/public-operating-config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Checkout",
  description: "Reserve Sky LA tickets and review your visit details before secure hosted payment.",
  referrer: "no-referrer",
  openGraph: {
    title: "Checkout | Sky LA",
    description: "Reserve Sky LA tickets and review your visit details before secure hosted payment."
  }
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CheckoutPage({ searchParams }: { searchParams: SearchParams }) {
  const [params, operatingConfig] = await Promise.all([searchParams, loadPublicOperatingConfig()]);
  const stripeStatus = firstParam(params.stripe);
  const checkoutSessionId = firstParam(params.session_id);
  const packageOptions = listTicketPackages()
    .map((ticket) => ({
      key: ticket.key,
      name: ticket.name,
      priceCents: ticket.priceCents
    }));
  const addonOptions = listAddons()
    .map((addon) => ({
      key: addon.key,
      name: addon.name,
      priceCents: addon.priceCents
    }));

  return (
    <main className="checkoutPage" data-native-checkout="true">
      <nav className="nav checkoutNav" aria-label="Primary navigation">
        <Link className="brand" href="/">
          Sky LA
        </Link>
        <div className="navLinks">
          <Link href="/cafe" prefetch={false}>Cafe</Link>
          <Link href="/experiences" prefetch={false}>Events</Link>
          <Link href="/members" prefetch={false}>Members</Link>
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
          Choose your visit, review the exact total, and continue to secure
          hosted card payment.
        </p>
      </section>

      <CheckoutClient
        packages={packageOptions}
        addons={addonOptions}
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
