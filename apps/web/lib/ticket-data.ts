import "server-only";

import { fetchQuery } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";

import { normalizeWebTicketCode } from "@/lib/ticket-identifiers";

export type PublicTicket = {
  ticketCode: string;
  bookingRef: string;
  status: string;
  visitDate?: string;
  entryTime?: string;
  partySize?: number;
};

const getTicketQuery = makeFunctionReference<
  "query",
  { ticketCode: string },
  PublicTicket
>("ticketDelivery:getTicket");

export class TicketNotFoundError extends Error {
  constructor(message = "Ticket was not found", options?: ErrorOptions) {
    super(message, options);
    this.name = "TicketNotFoundError";
  }
}

export class TicketBackendUnavailableError extends Error {
  constructor(message = "Ticket service is temporarily unavailable", options?: ErrorOptions) {
    super(message, options);
    this.name = "TicketBackendUnavailableError";
  }
}

function errorContainsTicketNotFound(error: unknown) {
  const visited = new Set<unknown>();
  let current: unknown = error;

  while (current && !visited.has(current)) {
    visited.add(current);
    if (current instanceof Error && /ticket was not found/i.test(current.message)) return true;
    if (typeof current === "object" && "data" in current) {
      const data = (current as { data?: unknown }).data;
      if (typeof data === "string" && /ticket was not found/i.test(data)) return true;
    }
    current = current instanceof Error ? current.cause : undefined;
  }

  return false;
}

export async function fetchPublicTicket(ticketCodeInput: string): Promise<PublicTicket> {
  let ticketCode: string;
  try {
    ticketCode = normalizeWebTicketCode(ticketCodeInput);
  } catch (error) {
    throw new TicketNotFoundError(undefined, { cause: error });
  }

  const deploymentUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!deploymentUrl) throw new TicketBackendUnavailableError("Ticket service is not configured");

  try {
    return await fetchQuery(getTicketQuery, { ticketCode }, { url: deploymentUrl });
  } catch (error) {
    if (errorContainsTicketNotFound(error)) {
      throw new TicketNotFoundError(undefined, { cause: error });
    }
    throw new TicketBackendUnavailableError(undefined, { cause: error });
  }
}
