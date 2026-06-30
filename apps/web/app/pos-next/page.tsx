import type { Metadata } from "next";
import Link from "next/link";
import { cafeItems, ticketPackages } from "@skyla/payments";
import { ShieldCheck } from "@skyla/ui/icons";
import { PosDraftClient } from "@/components/pos-draft-client";

export const metadata: Metadata = {
  title: "POS Draft",
  description: "Server-reviewed Sky LA POS sale drafts.",
  robots: {
    index: false,
    follow: false
  }
};

export default function PosNextPage() {
  const ticketOptions = Object.values(ticketPackages)
    .filter((ticket) => ticket.active)
    .map((ticket) => ({
      key: ticket.key,
      name: ticket.name,
      priceCents: ticket.priceCents
    }));
  const cafeOptions = Object.values(cafeItems)
    .filter((item) => item.active)
    .map((item) => ({
      key: item.key,
      name: item.name,
      priceCents: item.priceCents,
      category: item.category
    }));

  return (
    <main className="posNextPage">
      <header className="posNextHeader">
        <Link className="brand" href="/">
          Sky LA
        </Link>
        <div className="posNextStatus">
          <ShieldCheck size={18} />
          <span>Server-priced draft</span>
        </div>
        <nav aria-label="Staff navigation">
          <Link href="/admin" prefetch={false}>
            Admin
          </Link>
          <Link href="/pos" prefetch={false}>
            Live POS
          </Link>
        </nav>
      </header>

      <PosDraftClient tickets={ticketOptions} cafeItems={cafeOptions} />
    </main>
  );
}
