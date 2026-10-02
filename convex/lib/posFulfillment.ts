import { checkoutEntryTimes, parseVisitDate, type StoredOrderLineRecord } from "@skyla/payments";

export type PosFulfillmentSale = {
  saleRef: string;
  customerEmailLower?: string;
  visitDate?: string;
  entryTime?: string;
};

export type PosFulfillmentLine = Pick<StoredOrderLineRecord, "kind" | "quantity">;

export type ConfirmedPosBooking = {
  bookingRef: string;
  saleRef: string;
  visitDate: string;
  entryTime: string;
  partySize: number;
  status: "confirmed";
  emailLower?: string;
  createdAt: number;
  updatedAt: number;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const offeredEntryTimes = new Set<string>(checkoutEntryTimes.map((slot) => slot.value));

export function bookingRefFromSaleRef(value: string) {
  const saleRef = value.trim();
  if (!saleRef || saleRef.length > 80) {
    throw new Error("saleRef must be between 1 and 80 characters");
  }
  return saleRef;
}

/** Total admitted people across ticket lines; 0 for cafe/custom-only sales. */
export function posTicketPartySize(lines: readonly PosFulfillmentLine[]) {
  return lines.reduce((total, line) => {
    if (line.kind !== "ticket") return total;
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      throw new Error("POS ticket quantities must be positive integers");
    }
    return total + line.quantity;
  }, 0);
}

/**
 * Builds the booking for a paid POS sale from its stored, immutable selected
 * visit. Cafe/custom-only sales have no admission and return null. A sale
 * with ticket lines but no valid stored visit (older records) is rejected:
 * a processing date is never substituted for the guest's selected date.
 */
export function buildConfirmedPosFulfillment(
  sale: PosFulfillmentSale,
  lines: readonly PosFulfillmentLine[],
  now: number
) {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("now must be a non-negative safe integer timestamp");
  }
  const ticketQuantity = posTicketPartySize(lines);
  if (ticketQuantity === 0) return null;

  if (!parseVisitDate(sale.visitDate) || !sale.entryTime || !offeredEntryTimes.has(sale.entryTime)) {
    throw new Error("POS admission has no stored selected visit date and entry time");
  }
  const bookingRef = bookingRefFromSaleRef(sale.saleRef);
  const normalizedEmail = sale.customerEmailLower?.trim().toLowerCase();
  if (normalizedEmail && (!emailPattern.test(normalizedEmail) || normalizedEmail.length > 254)) {
    throw new Error("customerEmailLower must be a valid email address");
  }

  const booking: ConfirmedPosBooking = {
    bookingRef,
    saleRef: bookingRef,
    visitDate: sale.visitDate!,
    entryTime: sale.entryTime,
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
      entryTime: booking.entryTime,
      ticketQuantity,
      replaySafe: true
    }
  };
}
