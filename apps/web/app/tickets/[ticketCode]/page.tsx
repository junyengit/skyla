import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, ShieldCheck } from "@skyla/ui/icons";

import {
  fetchPublicTicket,
  TicketBackendUnavailableError,
  TicketNotFoundError,
  type PublicTicket
} from "@/lib/ticket-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your Ticket",
  robots: { index: false, follow: false }
};

type TicketPageProps = {
  params: Promise<{ ticketCode: string }>;
};

export default async function TicketPage({ params }: TicketPageProps) {
  const { ticketCode } = await params;
  let ticket: PublicTicket;
  try {
    ticket = await fetchPublicTicket(ticketCode);
  } catch (error) {
    if (error instanceof TicketNotFoundError) notFound();
    if (error instanceof TicketBackendUnavailableError) {
      return (
        <main className="ticketPage">
          <TicketNav />
          <section className="ticketPanel" aria-labelledby="ticket-title">
            <h1 id="ticket-title">Ticket temporarily unavailable</h1>
            <p>Keep your booking reference and email reservations@skydeckla.com for help.</p>
          </section>
        </main>
      );
    }
    throw error;
  }

  const isConfirmed = ticket.status === "confirmed";
  const isCheckedIn = ticket.status === "checked-in";
  const statusLabel = isConfirmed
    ? "Confirmed ticket"
    : isCheckedIn
      ? "Checked-in ticket"
      : ticket.status === "cancelled"
        ? "Cancelled ticket"
        : "Ticket unavailable for check-in";

  return (
    <main className="ticketPage">
      <TicketNav />
      <section className="ticketPanel" aria-labelledby="ticket-title">
        <div className="ticketStatus">
          {isConfirmed || isCheckedIn ? <ShieldCheck size={18} /> : null}
          {statusLabel}
        </div>
        <h1 id="ticket-title">Sky LA</h1>
        <p className="ticketRef">Booking {ticket.bookingRef}</p>
        {isConfirmed ? (
          <Image
            className="ticketQr"
            src={`/tickets/${encodeURIComponent(ticket.ticketCode)}/qr`}
            width="260"
            height="260"
            alt="QR code for this Sky LA ticket"
            unoptimized
          />
        ) : null}
        <dl className="ticketDetails">
          <div><dt>Status</dt><dd>{ticket.status}</dd></div>
          {ticket.visitDate ? <div><dt>Date</dt><dd>{ticket.visitDate}</dd></div> : null}
          {ticket.entryTime ? <div><dt>Entry</dt><dd>{ticket.entryTime}</dd></div> : null}
          {ticket.partySize ? <div><dt>Guests</dt><dd>{ticket.partySize}</dd></div> : null}
        </dl>
        <p className="ticketNote">
          <CalendarDays size={18} />
          {isConfirmed
            ? "Present this code at the front desk."
            : isCheckedIn
              ? "This ticket has already been checked in."
              : ticket.status === "cancelled"
                ? "This booking was cancelled and cannot be used for check-in."
                : "This ticket cannot currently be used for check-in."}
        </p>
        <Link className="ticketHomeLink" href="/">Back to Sky LA</Link>
      </section>
    </main>
  );
}

function TicketNav() {
  return (
    <nav className="nav checkoutNav" aria-label="Primary navigation">
      <Link className="brand" href="/">Sky LA</Link>
      <Link className="navCta" href="/checkout">Tickets</Link>
    </nav>
  );
}
