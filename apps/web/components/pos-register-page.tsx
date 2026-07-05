import Link from "next/link";
import { listCafeItems, listTicketPackages } from "@skyla/payments";
import { ShieldCheck } from "@skyla/ui/icons";
import { PosDraftClient } from "@/components/pos-draft-client";

type PosRegisterPageProps = {
  variant: "primary" | "draft";
};

function terminalAcceptanceEnabled() {
  return process.env.SKYLA_POS_TERMINAL_ACCEPTANCE === "enabled";
}

export function PosRegisterPage({ variant }: PosRegisterPageProps) {
  const ticketOptions = listTicketPackages()
    .map((ticket) => ({
      key: ticket.key,
      name: ticket.name,
      priceCents: ticket.priceCents
    }));
  const cafeOptions = listCafeItems()
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
          {variant === "draft" ? (
            <Link href="/pos" prefetch={false}>
              Live POS
            </Link>
          ) : null}
        </nav>
      </header>

      <PosDraftClient tickets={ticketOptions} cafeItems={cafeOptions} terminalAccepted={terminalAcceptanceEnabled()} />
    </main>
  );
}
