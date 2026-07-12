import { describe, expect, it } from "vitest";

import {
  assertCheckoutFulfillmentReady,
  bookingRefFromOrderRef,
  buildConfirmedCheckoutFulfillment,
  type CheckoutFulfillmentOrder
} from "./lib/checkoutFulfillment";

const now = Date.UTC(2026, 6, 12, 12);
const order: CheckoutFulfillmentOrder = {
  orderRef: "SKY2607-ABC123",
  channel: "online",
  customerEmailLower: "guest@example.com",
  visitDate: "2026-07-20",
  entryTime: "18:30"
};
const lines = [
  { kind: "ticket" as const, quantity: 2 },
  { kind: "addon" as const, quantity: 1 }
];

describe("checkout fulfillment helpers", () => {
  it("builds a normalized confirmed booking and scalar-only audit metadata", () => {
    const result = buildConfirmedCheckoutFulfillment(
      { ...order, customerEmailLower: " Guest@Example.com " },
      lines,
      now
    );

    expect(result.booking).toEqual({
      bookingRef: "SKY2607-ABC123",
      orderRef: "SKY2607-ABC123",
      visitDate: "2026-07-20",
      entryTime: "18:30",
      partySize: 2,
      status: "confirmed",
      emailLower: "guest@example.com",
      createdAt: now,
      updatedAt: now
    });
    expect(result.auditMetadata).toEqual({
      action: "checkout_booking_confirmed",
      bookingRef: "SKY2607-ABC123",
      orderRef: "SKY2607-ABC123",
      channel: "online",
      status: "confirmed",
      visitDate: "2026-07-20",
      entryTime: "18:30",
      ticketQuantity: 2,
      replaySafe: true
    });
    expect(Object.values(result.auditMetadata).every((value) => ["string", "number", "boolean"].includes(typeof value))).toBe(
      true
    );
  });

  it.each([undefined, "   "])("rejects missing customerEmailLower (%s)", (customerEmailLower) => {
    expect(() => assertCheckoutFulfillmentReady({ ...order, customerEmailLower }, lines, now)).toThrow(
      "customerEmailLower is required for checkout fulfillment"
    );
  });

  it("rejects an invalid customerEmailLower", () => {
    expect(() => assertCheckoutFulfillmentReady({ ...order, customerEmailLower: "not-an-email" }, lines, now)).toThrow(
      "customerEmailLower must be a valid email address"
    );
  });

  it("rejects a missing or invalid visitDate", () => {
    expect(() => assertCheckoutFulfillmentReady({ ...order, visitDate: undefined }, lines, now)).toThrow(
      "visitDate is required for checkout fulfillment"
    );
    expect(() => assertCheckoutFulfillmentReady({ ...order, visitDate: "07/20/2026" }, lines, now)).toThrow(
      "visitDate must use YYYY-MM-DD"
    );
    expect(() => assertCheckoutFulfillmentReady({ ...order, visitDate: "2026-02-31" }, lines, now)).toThrow(
      "visitDate must be a real calendar date"
    );
    expect(() => assertCheckoutFulfillmentReady({ ...order, visitDate: "2026-07-11" }, lines, now)).toThrow(
      "visitDate cannot be in the past"
    );
    expect(() => assertCheckoutFulfillmentReady({ ...order, visitDate: "2027-07-13" }, lines, now)).toThrow(
      "visitDate must be within 365 days"
    );
  });

  it("rejects a missing or invalid entryTime", () => {
    expect(() => assertCheckoutFulfillmentReady({ ...order, entryTime: undefined }, lines, now)).toThrow(
      "entryTime is required for checkout fulfillment"
    );
    expect(() => assertCheckoutFulfillmentReady({ ...order, entryTime: "7:00 " }, lines, now)).toThrow(
      "entryTime must use HH:mm"
    );
    expect(() => assertCheckoutFulfillmentReady({ ...order, entryTime: "25:00" }, lines, now)).toThrow(
      "entryTime must use HH:mm"
    );
    expect(() => assertCheckoutFulfillmentReady({ ...order, entryTime: "03:00" }, lines, now)).toThrow(
      "entryTime must be an available checkout entry time"
    );
  });

  it("rejects orders without a positive-quantity ticket line", () => {
    expect(() => assertCheckoutFulfillmentReady(order, [{ kind: "addon", quantity: 1 }], now)).toThrow(
      "Checkout fulfillment requires at least one ticket line with a positive integer quantity"
    );
    expect(() => assertCheckoutFulfillmentReady(order, [{ kind: "ticket", quantity: 0 }], now)).toThrow(
      "Checkout fulfillment requires at least one ticket line with a positive integer quantity"
    );
  });

  it("derives the same booking reference for retries of one order", () => {
    expect(bookingRefFromOrderRef(" SKY2607-ABC123 ")).toBe("SKY2607-ABC123");
    expect(bookingRefFromOrderRef("SKY2607-ABC123")).toBe(bookingRefFromOrderRef("SKY2607-ABC123"));
    expect(buildConfirmedCheckoutFulfillment(order, lines, now).booking.bookingRef).toBe(
      buildConfirmedCheckoutFulfillment(order, lines, now + 1).booking.bookingRef
    );
  });
});
