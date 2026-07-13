export type TicketDeliverySeed = {
  ticketCode: string;
  bookingRef: string;
  orderRef?: string;
  saleRef?: string;
  emailLower?: string;
};

const ticketCodePattern = /^tkt_[a-f0-9]{32}$/;

export function normalizeTicketCode(value: string) {
  const ticketCode = value.trim().toLowerCase();
  if (!ticketCodePattern.test(ticketCode)) throw new Error("ticketCode is invalid");
  return ticketCode;
}

export function buildTicketDeliveryRecord(seed: TicketDeliverySeed, now: number) {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("now must be a non-negative safe integer timestamp");
  }
  const bookingRef = requiredText(seed.bookingRef, "bookingRef", 80);
  const orderRef = optionalText(seed.orderRef, "orderRef", 80);
  const saleRef = optionalText(seed.saleRef, "saleRef", 80);
  const emailLower = optionalText(seed.emailLower?.toLowerCase(), "emailLower", 254);
  return {
    ticketCode: normalizeTicketCode(seed.ticketCode),
    bookingRef,
    ...(orderRef ? { orderRef } : {}),
    ...(saleRef ? { saleRef } : {}),
    ...(emailLower ? { emailLower } : {}),
    status: emailLower ? ("queued" as const) : ("suppressed" as const),
    attemptCount: 0,
    sendVersion: 1,
    ...(emailLower ? {} : { failureReason: "customer_email_missing" }),
    createdAt: now,
    updatedAt: now
  };
}

function requiredText(value: string, label: string, maxLength: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${label} must be between 1 and ${maxLength} characters`);
  }
  return normalized;
}

function optionalText(value: string | undefined, label: string, maxLength: number) {
  if (value === undefined) return undefined;
  return requiredText(value, label, maxLength);
}
