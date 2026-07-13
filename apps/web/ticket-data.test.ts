import { fetchQuery } from "convex/nextjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchPublicTicket,
  TicketBackendUnavailableError,
  TicketNotFoundError
} from "./lib/ticket-data";
import { normalizeTicketOrigin, normalizeWebTicketCode } from "./lib/ticket-identifiers";

vi.mock("server-only", () => ({}));
vi.mock("convex/nextjs", () => ({ fetchQuery: vi.fn() }));

const fetchQueryMock = vi.mocked(fetchQuery);
const ticketCode = "tkt_0123456789abcdef0123456789abcdef";

afterEach(() => {
  delete process.env.NEXT_PUBLIC_CONVEX_URL;
  delete process.env.CONVEX_URL;
  fetchQueryMock.mockReset();
});

describe("public ticket identity", () => {
  it("normalizes opaque ticket codes", () => {
    expect(normalizeWebTicketCode(" TKT_0123456789ABCDEF0123456789ABCDEF ")).toBe(
      "tkt_0123456789abcdef0123456789abcdef"
    );
  });

  it("rejects guessable or malformed ticket paths", () => {
    expect(() => normalizeWebTicketCode("SALE260713-ABC123")).toThrow("Ticket was not found");
  });

  it("accepts only a bare HTTPS origin for generated ticket URLs", () => {
    expect(normalizeTicketOrigin(" https://tickets.skydeckla.com ")).toBe("https://tickets.skydeckla.com");
    expect(() => normalizeTicketOrigin(undefined)).toThrow("must be configured");
    expect(() => normalizeTicketOrigin("http://skydeckla.com")).toThrow("must be an HTTPS origin");
    expect(() => normalizeTicketOrigin("https://skydeckla.com/tickets")).toThrow("must be an HTTPS origin");
  });
});

describe("public ticket server bridge", () => {
  it("returns the public ticket from the configured Convex deployment", async () => {
    process.env.CONVEX_URL = "https://example.convex.cloud";
    const ticket = {
      ticketCode,
      bookingRef: "SKY260713-ABC123",
      status: "confirmed",
      visitDate: "2026-07-13",
      entryTime: "18:00",
      partySize: 2
    };
    fetchQueryMock.mockResolvedValueOnce(ticket);

    await expect(fetchPublicTicket(ticketCode.toUpperCase())).resolves.toEqual(ticket);
    expect(fetchQueryMock).toHaveBeenCalledWith(
      expect.anything(),
      { ticketCode },
      { url: "https://example.convex.cloud" }
    );
  });

  it("classifies malformed and missing ticket codes as not found", async () => {
    await expect(fetchPublicTicket("SALE260713-ABC123")).rejects.toBeInstanceOf(TicketNotFoundError);
    expect(fetchQueryMock).not.toHaveBeenCalled();

    process.env.CONVEX_URL = "https://example.convex.cloud";
    fetchQueryMock.mockRejectedValueOnce(
      new Error("[CONVEX Q(ticketDelivery:getTicket)] Server Error: Ticket was not found")
    );
    await expect(fetchPublicTicket(ticketCode)).rejects.toBeInstanceOf(TicketNotFoundError);
  });

  it("classifies missing configuration and transient Convex failures as unavailable", async () => {
    await expect(fetchPublicTicket(ticketCode)).rejects.toBeInstanceOf(TicketBackendUnavailableError);

    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    const transientFailure = new Error("fetch failed");
    fetchQueryMock.mockRejectedValueOnce(transientFailure);

    await expect(fetchPublicTicket(ticketCode)).rejects.toMatchObject({
      name: "TicketBackendUnavailableError",
      cause: transientFailure
    });
  });
});
