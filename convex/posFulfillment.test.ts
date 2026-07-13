import { describe, expect, it } from "vitest";

import {
  bookingRefFromSaleRef,
  buildConfirmedPosFulfillment,
  venueDateFromTimestamp
} from "./lib/posFulfillment";

describe("POS ticket fulfillment", () => {
  it("creates a same-day confirmed booking for ticket lines", () => {
    const now = Date.parse("2026-07-13T08:00:00.000Z");
    const result = buildConfirmedPosFulfillment(
      { saleRef: " SALE260713-ABC123 ", customerEmailLower: " Guest@Example.com " },
      [
        { kind: "ticket", quantity: 2 },
        { kind: "cafe", quantity: 1 }
      ],
      now
    );

    expect(result?.booking).toEqual({
      bookingRef: "SALE260713-ABC123",
      saleRef: "SALE260713-ABC123",
      visitDate: "2026-07-13",
      partySize: 2,
      status: "confirmed",
      emailLower: "guest@example.com",
      createdAt: now,
      updatedAt: now
    });
  });

  it("does not create a booking for cafe-only sales", () => {
    expect(
      buildConfirmedPosFulfillment(
        { saleRef: "SALE260713-CAFE" },
        [{ kind: "cafe", quantity: 2 }],
        Date.parse("2026-07-13T18:00:00.000Z")
      )
    ).toBeNull();
  });

  it("uses the Los Angeles calendar date", () => {
    expect(venueDateFromTimestamp(Date.parse("2026-07-13T06:30:00.000Z"))).toBe("2026-07-12");
  });

  it("normalizes a sale reference and rejects invalid ticket quantities", () => {
    expect(bookingRefFromSaleRef(" SALE-1 ")).toBe("SALE-1");
    expect(() =>
      buildConfirmedPosFulfillment(
        { saleRef: "SALE-1" },
        [{ kind: "ticket", quantity: 0 }],
        Date.parse("2026-07-13T18:00:00.000Z")
      )
    ).toThrow("positive integers");
  });
});
