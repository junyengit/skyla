import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ticketMocks = vi.hoisted(() => {
  class TicketNotFoundError extends Error {}
  class TicketBackendUnavailableError extends Error {}

  return {
    fetchPublicTicket: vi.fn(),
    notFound: vi.fn(() => {
      throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
    }),
    TicketNotFoundError,
    TicketBackendUnavailableError
  };
});

vi.mock("@/lib/ticket-data", () => ({
  fetchPublicTicket: ticketMocks.fetchPublicTicket,
  TicketNotFoundError: ticketMocks.TicketNotFoundError,
  TicketBackendUnavailableError: ticketMocks.TicketBackendUnavailableError
}));
vi.mock("next/navigation", () => ({ notFound: ticketMocks.notFound }));

import TicketPage from "./app/tickets/[ticketCode]/page";
import { GET } from "./app/tickets/[ticketCode]/qr/route";

const ticketCode = "tkt_0123456789abcdef0123456789abcdef";
const confirmedTicket = {
  ticketCode,
  bookingRef: "SKY260713-ABC123",
  status: "confirmed",
  visitDate: "2026-07-13",
  entryTime: "18:00",
  partySize: 2
};

function pageProps() {
  return { params: Promise.resolve({ ticketCode }) };
}

function qrRequest() {
  return GET(new Request(`https://skydeckla.com/tickets/${ticketCode}/qr`), pageProps());
}

beforeEach(() => {
  process.env.SKYLA_PUBLIC_ORIGIN = "https://skydeckla.com";
  ticketMocks.fetchPublicTicket.mockReset();
  ticketMocks.notFound.mockClear();
});

describe("public ticket page", () => {
  it("shows an active QR and check-in instruction only for confirmed tickets", async () => {
    ticketMocks.fetchPublicTicket.mockResolvedValueOnce(confirmedTicket);

    const html = renderToStaticMarkup(await TicketPage(pageProps()));

    expect(html).toContain("Confirmed ticket");
    expect(html).toContain("Present this code at the front desk.");
    expect(html).toContain(`/tickets/${ticketCode}/qr`);
  });

  it("renders a cancelled ticket without an active QR or check-in instruction", async () => {
    ticketMocks.fetchPublicTicket.mockResolvedValueOnce({
      ...confirmedTicket,
      status: "cancelled"
    });

    const html = renderToStaticMarkup(await TicketPage(pageProps()));

    expect(html).toContain("Cancelled ticket");
    expect(html).toContain("cannot be used for check-in");
    expect(html).not.toContain("Confirmed ticket");
    expect(html).not.toContain("Present this code at the front desk.");
    expect(html).not.toContain(`/tickets/${ticketCode}/qr`);
  });

  it("uses the temporary-unavailable state for backend failures", async () => {
    ticketMocks.fetchPublicTicket.mockRejectedValueOnce(
      new ticketMocks.TicketBackendUnavailableError("fetch failed")
    );

    const html = renderToStaticMarkup(await TicketPage(pageProps()));

    expect(html).toContain("Ticket temporarily unavailable");
    expect(ticketMocks.notFound).not.toHaveBeenCalled();
  });

  it("uses the Next 404 boundary only for true missing tickets", async () => {
    ticketMocks.fetchPublicTicket.mockRejectedValueOnce(new ticketMocks.TicketNotFoundError());

    await expect(TicketPage(pageProps())).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(ticketMocks.notFound).toHaveBeenCalledOnce();
  });
});

describe("public ticket QR route", () => {
  it("returns an uncached SVG for a confirmed ticket", async () => {
    ticketMocks.fetchPublicTicket.mockResolvedValueOnce(confirmedTicket);

    const response = await qrRequest();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toContain("<svg");
  });

  it("returns Gone instead of a usable QR for a cancelled ticket", async () => {
    ticketMocks.fetchPublicTicket.mockResolvedValueOnce({
      ...confirmedTicket,
      status: "cancelled"
    });

    const response = await qrRequest();

    expect(response.status).toBe(410);
    expect(await response.text()).toBe("Cancelled tickets cannot be used for check-in");
  });

  it("distinguishes missing tickets from transient backend failures", async () => {
    ticketMocks.fetchPublicTicket.mockRejectedValueOnce(new ticketMocks.TicketNotFoundError());
    const missingResponse = await qrRequest();
    expect(missingResponse.status).toBe(404);

    ticketMocks.fetchPublicTicket.mockRejectedValueOnce(
      new ticketMocks.TicketBackendUnavailableError("fetch failed")
    );
    const unavailableResponse = await qrRequest();
    expect(unavailableResponse.status).toBe(503);
    expect(unavailableResponse.headers.get("cache-control")).toBe("private, no-store");
  });
});
