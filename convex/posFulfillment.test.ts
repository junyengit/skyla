import { describe, expect, it } from "vitest";

import { bookingRefFromSaleRef, buildConfirmedPosFulfillment, posTicketPartySize } from "./lib/posFulfillment";

describe("POS ticket fulfillment", () => {
  it("books the stored selected visit, not the processing date", () => {
    // 8:00 UTC is still July 13 in Los Angeles; the guest chose July 20.
    const now = Date.parse("2026-07-13T08:00:00.000Z");
    const result = buildConfirmedPosFulfillment(
      {
        saleRef: " SALE260713-ABC123 ",
        customerEmailLower: " Guest@Example.com ",
        visitDate: "2026-07-20",
        entryTime: "14:00"
      },
      [
        { kind: "ticket", quantity: 2 },
        { kind: "ticket", quantity: 3 },
        { kind: "cafe", quantity: 1 }
      ],
      now
    );

    expect(result?.booking).toEqual({
      bookingRef: "SALE260713-ABC123",
      saleRef: "SALE260713-ABC123",
      visitDate: "2026-07-20",
      entryTime: "14:00",
      partySize: 5,
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

  it("never invents a visit for an older ticket sale without one", () => {
    expect(() =>
      buildConfirmedPosFulfillment(
        { saleRef: "SALE-LEGACY" },
        [{ kind: "ticket", quantity: 1 }],
        Date.parse("2026-07-13T18:00:00.000Z")
      )
    ).toThrow("no stored selected visit");
    expect(() =>
      buildConfirmedPosFulfillment(
        { saleRef: "SALE-LEGACY", visitDate: "2026-07-13", entryTime: "14:10" },
        [{ kind: "ticket", quantity: 1 }],
        Date.parse("2026-07-13T18:00:00.000Z")
      )
    ).toThrow("no stored selected visit");
  });

  it("normalizes a sale reference and rejects invalid ticket quantities", () => {
    expect(bookingRefFromSaleRef(" SALE-1 ")).toBe("SALE-1");
    expect(() => posTicketPartySize([{ kind: "ticket", quantity: 0 }])).toThrow("positive integers");
    expect(() => posTicketPartySize([{ kind: "ticket", quantity: 1.5 }])).toThrow("positive integers");
  });
});
