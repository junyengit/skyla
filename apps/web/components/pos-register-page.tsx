import Link from "next/link";
import { cafeItems, ticketPackages } from "@skyla/payments";
import { ShieldCheck } from "@skyla/ui/icons";
import { PosDraftClient } from "@/components/pos-draft-client";

type PosRegisterPageProps = {
  variant: "primary" | "draft";
};

function terminalAcceptanceEnabled() {
  return process.env.SKYLA_POS_TERMINAL_ACCEPTANCE === "enabled";
}

export function PosRegisterPage({ variant }: PosRegisterPageProps) {
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
    <main className="posNextPage" data-pos-route={variant}>
      <header className="posNextHeader">
        <Link className="brand" href="/">
          Sky LA
        </Link>
        <div className="posNextStatus">
          <ShieldCheck size={18} />
          <span>{variant === "primary" ? "Server-priced POS" : "Server-priced draft"}</span>
        </div>
        <nav aria-label="Staff navigation">
          <Link href="/admin" prefetch={false}>
            Admin
          </Link>
          {variant === "primary" ? (
            <Link href="/pos.html" prefetch={false}>
              Legacy POS
            </Link>
          ) : (
            <Link href="/pos" prefetch={false}>
              Live POS
            </Link>
          )}
        </nav>
      </header>

      <PosDraftClient tickets={ticketOptions} cafeItems={cafeOptions} terminalAccepted={terminalAcceptanceEnabled()} />
    </main>
  );
}
