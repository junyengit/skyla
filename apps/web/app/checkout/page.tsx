import type { Metadata } from "next";
import Link from "next/link";
import { addons, ticketPackages } from "@skyla/payments";
import { ArrowRight, MapPin, ShieldCheck } from "@skyla/ui/icons";
import { siteConfig } from "@skyla/config";
import { CheckoutClient } from "@/components/checkout-client";

export const metadata: Metadata = {
  title: "Checkout",
  description: "Reserve Sky LA tickets through the server-backed checkout flow."
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CheckoutPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const stripeStatus = firstParam(params.stripe);
  const orderRef = firstParam(params.order);
  const packageOptions = Object.values(ticketPackages)
    .filter((ticket) => ticket.active)
    .map((ticket) => ({
      key: ticket.key,
      name: ticket.name,
      priceCents: ticket.priceCents
    }));
  const addonOptions = Object.values(addons)
    .filter((addon) => addon.active)
    .map((addon) => ({
      key: addon.key,
      name: addon.name,
      priceCents: addon.priceCents
    }));

  return (
    <main className="checkoutPage">
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
          Pick a visit, confirm the server-calculated total, then continue to
          hosted card payment when the Convex and Stripe dashboards are wired.
        </p>
      </section>

      <CheckoutClient
        packages={packageOptions}
        addons={addonOptions}
        stripeStatus={stripeStatus === "success" || stripeStatus === "cancel" ? stripeStatus : undefined}
        returnedOrderRef={orderRef}
      />

      <section className="checkoutTrust" aria-label="Checkout safeguards">
        <div>
          <ShieldCheck size={22} />
          <span>Server totals only</span>
        </div>
        <div>
          <ArrowRight size={22} />
          <span>Stripe hosted payment after Convex persistence</span>
        </div>
      </section>
    </main>
  );
}
