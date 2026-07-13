import type { StoredOrderLineRecord } from "@skyla/payments";

export type PosFulfillmentSale = {
  saleRef: string;
  customerEmailLower?: string;
};

export type PosFulfillmentLine = Pick<StoredOrderLineRecord, "kind" | "quantity">;

export type ConfirmedPosBooking = {
  bookingRef: string;
  saleRef: string;
  visitDate: string;
  partySize: number;
  status: "confirmed";
  emailLower?: string;
  createdAt: number;
  updatedAt: number;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function bookingRefFromSaleRef(value: string) {
  const saleRef = value.trim();
  if (!saleRef || saleRef.length > 80) {
    throw new Error("saleRef must be between 1 and 80 characters");
  }
  return saleRef;
}

export function venueDateFromTimestamp(timestamp: number) {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error("now must be a non-negative safe integer timestamp");
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(timestamp));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function buildConfirmedPosFulfillment(
  sale: PosFulfillmentSale,
  lines: readonly PosFulfillmentLine[],
  now: number
) {
  const ticketQuantity = lines.reduce((total, line) => {
    if (line.kind !== "ticket") return total;
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error("POS ticket quantities must be positive integers");
    }
    return total + line.quantity;
  }, 0);
  if (ticketQuantity === 0) return null;

  const bookingRef = bookingRefFromSaleRef(sale.saleRef);
  const normalizedEmail = sale.customerEmailLower?.trim().toLowerCase();
  if (normalizedEmail && (!emailPattern.test(normalizedEmail) || normalizedEmail.length > 254)) {
    throw new Error("customerEmailLower must be a valid email address");
  }

  const booking: ConfirmedPosBooking = {
    bookingRef,
    saleRef: bookingRef,
    visitDate: venueDateFromTimestamp(now),
    partySize: ticketQuantity,
    status: "confirmed",
    ...(normalizedEmail ? { emailLower: normalizedEmail } : {}),
    createdAt: now,
    updatedAt: now
  };

  return {
    booking,
    auditMetadata: {
      action: "pos_ticket_booking_confirmed",
      bookingRef,
      saleRef: bookingRef,
      channel: "pos",
      status: "confirmed",
      visitDate: booking.visitDate,
      ticketQuantity,
      replaySafe: true
    }
  };
}
