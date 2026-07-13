import QRCode from "qrcode";

import {
  fetchPublicTicket,
  TicketBackendUnavailableError,
  TicketNotFoundError
} from "@/lib/ticket-data";
import { normalizeTicketOrigin } from "@/lib/ticket-identifiers";

export const dynamic = "force-dynamic";

type TicketQrRouteContext = {
  params: Promise<{ ticketCode: string }>;
};

function ticketQrError(body: string, status: number) {
  return new Response(body, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow"
    }
  });
}

export async function GET(request: Request, context: TicketQrRouteContext) {
  try {
    const { ticketCode } = await context.params;
    const ticket = await fetchPublicTicket(ticketCode);
    if (ticket.status === "cancelled") {
      return ticketQrError("Cancelled tickets cannot be used for check-in", 410);
    }
    if (ticket.status !== "confirmed") {
      return ticketQrError("This ticket is no longer active for check-in", 410);
    }
    const origin = normalizeTicketOrigin(process.env.SKYLA_PUBLIC_ORIGIN);
    const ticketUrl = new URL(`/tickets/${encodeURIComponent(ticket.ticketCode)}`, origin).toString();
    const svg = await QRCode.toString(ticketUrl, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 2,
      width: 260,
      color: { dark: "#09090b", light: "#ffffff" }
    });
    return new Response(svg, {
      headers: {
        "cache-control": "private, no-store",
        "content-type": "image/svg+xml; charset=utf-8",
        "x-content-type-options": "nosniff",
        "x-robots-tag": "noindex, nofollow"
      }
    });
  } catch (error) {
    if (error instanceof TicketNotFoundError) {
      return ticketQrError("Ticket was not found", 404);
    }
    if (error instanceof TicketBackendUnavailableError) {
      return ticketQrError("Ticket service is temporarily unavailable", 503);
    }
    return ticketQrError("Ticket QR code is temporarily unavailable", 503);
  }
}
