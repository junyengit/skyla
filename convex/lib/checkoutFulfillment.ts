import {
  checkoutBookingWindowDays,
  checkoutEntryTimes,
  type StoredOrderLineRecord,
  type StoredOrderRecord
} from "@skyla/payments";

export type CheckoutFulfillmentOrder = Pick<
  StoredOrderRecord,
  "orderRef" | "customerEmailLower" | "visitDate" | "entryTime"
> & {
  channel: "online" | "pos";
};

export type CheckoutFulfillmentLine = Pick<StoredOrderLineRecord, "kind" | "quantity">;

export type CheckoutFulfillmentReady = {
  orderRef: string;
  customerEmailLower: string;
  visitDate: string;
  entryTime: string;
  ticketQuantity: number;
};

export type ConfirmedCheckoutBooking = {
  bookingRef: string;
  orderRef: string;
  visitDate: string;
  entryTime: string;
  partySize: number;
  status: "confirmed";
  emailLower: string;
  createdAt: number;
  updatedAt: number;
};

export type CheckoutFulfillmentAuditMetadata = Record<string, string | number | boolean>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const dayMs = 24 * 60 * 60 * 1000;
const allowedEntryTimes = new Set<string>(checkoutEntryTimes.map((slot) => slot.value));

function requiredTrimmed(value: string | undefined, label: string, maxLength: number) {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${label} is required for checkout fulfillment`);
  }
  if (normalized.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer`);
  }
  return normalized;
}

function normalizeCustomerEmailLower(value: string | undefined) {
  const email = requiredTrimmed(value, "customerEmailLower", 254).toLowerCase();
  if (!emailPattern.test(email)) {
    throw new Error("customerEmailLower must be a valid email address");
  }
  return email;
}

function normalizeVisitDate(value: string | undefined, now: number) {
  const visitDate = requiredTrimmed(value, "visitDate", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) {
    throw new Error("visitDate must use YYYY-MM-DD");
  }
  const date = new Date(`${visitDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== visitDate) {
    throw new Error("visitDate must be a real calendar date");
  }
  const nowDate = new Date(now);
  const today = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate());
  if (date.getTime() < today) {
    throw new Error("visitDate cannot be in the past");
  }
  if (date.getTime() > today + checkoutBookingWindowDays * dayMs) {
    throw new Error(`visitDate must be within ${checkoutBookingWindowDays} days`);
  }
  return visitDate;
}

function normalizeEntryTime(value: string | undefined) {
  const entryTime = requiredTrimmed(value, "entryTime", 5);
  if (!timePattern.test(entryTime)) {
    throw new Error("entryTime must use HH:mm");
  }
  if (!allowedEntryTimes.has(entryTime)) {
    throw new Error("entryTime must be an available checkout entry time");
  }
  return entryTime;
}

export function bookingRefFromOrderRef(orderRef: string) {
  return requiredTrimmed(orderRef, "orderRef", 80);
}

export function assertCheckoutFulfillmentReady(
  order: CheckoutFulfillmentOrder,
  lines: readonly CheckoutFulfillmentLine[],
  now = Date.now()
): CheckoutFulfillmentReady {
  if (order.channel !== "online") {
    throw new Error("Checkout fulfillment requires an online order");
  }

  const ticketQuantity = lines.reduce((total, line) => {
    if (line.kind !== "ticket" || !Number.isInteger(line.quantity) || line.quantity <= 0) {
      return total;
    }
    return total + line.quantity;
  }, 0);

  if (ticketQuantity === 0) {
    throw new Error("Checkout fulfillment requires at least one ticket line with a positive integer quantity");
  }

  return {
    orderRef: bookingRefFromOrderRef(order.orderRef),
    customerEmailLower: normalizeCustomerEmailLower(order.customerEmailLower),
    visitDate: normalizeVisitDate(order.visitDate, now),
    entryTime: normalizeEntryTime(order.entryTime),
    ticketQuantity
  };
}

export function buildConfirmedCheckoutFulfillment(
  order: CheckoutFulfillmentOrder,
  lines: readonly CheckoutFulfillmentLine[],
  now: number
) {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("now must be a non-negative safe integer timestamp");
  }

  const ready = assertCheckoutFulfillmentReady(order, lines, now);
  const bookingRef = bookingRefFromOrderRef(ready.orderRef);

  const booking: ConfirmedCheckoutBooking = {
    bookingRef,
    orderRef: ready.orderRef,
    visitDate: ready.visitDate,
    entryTime: ready.entryTime,
    partySize: ready.ticketQuantity,
    status: "confirmed",
    emailLower: ready.customerEmailLower,
    createdAt: now,
    updatedAt: now
  };
  const auditMetadata: CheckoutFulfillmentAuditMetadata = {
    action: "checkout_booking_confirmed",
    bookingRef,
    orderRef: ready.orderRef,
    channel: "online",
    status: "confirmed",
    visitDate: ready.visitDate,
    entryTime: ready.entryTime,
    ticketQuantity: ready.ticketQuantity,
    replaySafe: true
  };

  return { booking, auditMetadata };
}
