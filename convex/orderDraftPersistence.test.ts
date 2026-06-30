import { describe, expect, it } from "vitest";

import {
  assertSameDraftFingerprint,
  buildCheckoutDraftWrite,
  buildPosSaleDraftWrite,
  checkoutDraftFingerprint,
  checkoutDraftResult,
  normalizeCheckoutDraftArgs,
  posSaleDraftFingerprint
} from "./lib/orderDraftPersistence";

const now = Date.UTC(2026, 6, 4, 12);

describe("Convex order draft persistence helpers", () => {
  it("builds canonical checkout order docs and ignores browser totals", () => {
    const write = buildCheckoutDraftWrite(
      {
        packageKey: "general",
        adults: 2,
        children: 1,
        addons: { matcha: 1 },
        customerEmail: "Guest@Example.com",
        idempotencyKey: "checkout_000001",
        totalCents: 1
      } as Parameters<typeof buildCheckoutDraftWrite>[0] & { totalCents: number },
      { orderRef: "SKY2607-ABC123", now }
    );

    expect(write.order).toMatchObject({
      orderRef: "SKY2607-ABC123",
      subtotalCents: 8100,
      feeCents: 405,
      totalCents: 8505,
      customerEmailLower: "guest@example.com",
      idempotencyKey: "checkout_000001",
      source: "convex"
    });
    expect(write.lines).toHaveLength(3);
    expect(write.lines[0]).toEqual(expect.objectContaining({ orderRef: "SKY2607-ABC123", lineTotalCents: 5800 }));
  });

  it("normalizes equivalent checkout carts to the same fingerprint", () => {
    const first = normalizeCheckoutDraftArgs({
      packageKey: "general",
      adults: 1,
      children: 0,
      addons: { matcha: 0 },
      customerEmail: "GUEST@EXAMPLE.COM",
      idempotencyKey: "checkout_000002"
    });
    const second = normalizeCheckoutDraftArgs({
      packageKey: "general",
      adults: 1,
      customerEmail: "guest@example.com",
      idempotencyKey: "checkout_000002"
    });

    expect(checkoutDraftFingerprint(first)).toBe(checkoutDraftFingerprint(second));
    expect(() => assertSameDraftFingerprint(checkoutDraftFingerprint(first), checkoutDraftFingerprint(second))).not.toThrow();
  });

  it("rejects idempotency reuse with a different checkout draft", () => {
    const first = buildCheckoutDraftWrite(
      { packageKey: "general", adults: 1, idempotencyKey: "checkout_000003" },
      { orderRef: "SKY2607-ABC123", now }
    );
    const second = buildCheckoutDraftWrite(
      { packageKey: "drink", adults: 1, idempotencyKey: "checkout_000003" },
      { orderRef: "SKY2607-DEF456", now }
    );

    expect(() => assertSameDraftFingerprint(first.draftFingerprint, second.draftFingerprint)).toThrow(
      "idempotencyKey was already used for a different draft"
    );
  });

  it("returns a stable public line shape for persisted read-backs", () => {
    const write = buildCheckoutDraftWrite(
      { packageKey: "general", adults: 1, idempotencyKey: "checkout_000006" },
      { orderRef: "SKY2607-ABC123", now }
    );
    const result = checkoutDraftResult(write.order, [
      { ...write.lines[0], _id: "line_id", _creationTime: 123 } as (typeof write.lines)[number]
    ]);

    expect(result.lines[0]).toEqual({
      kind: "ticket",
      productKey: "general",
      name: "General Admission",
      quantity: 1,
      unitAmountCents: 2900,
      lineTotalCents: 2900
    });
  });

  it("validates checkout dates, times, emails, and bounded quantities", () => {
    expect(() =>
      buildCheckoutDraftWrite(
        {
          packageKey: "general",
          adults: 1,
          visitDate: "2026-02-31",
          idempotencyKey: "checkout_000004"
        },
        { orderRef: "SKY2607-ABC123", now }
      )
    ).toThrow("visitDate must be a real calendar date");

    expect(() =>
      buildCheckoutDraftWrite(
        {
          packageKey: "general",
          adults: 21,
          entryTime: "25:00",
          customerEmail: "not-an-email",
          idempotencyKey: "checkout_000005"
        },
        { orderRef: "SKY2607-ABC123", now }
      )
    ).toThrow("adults must be an integer from 1 to 20");
  });

  it("builds staff-attributed POS sale docs with role-derived pricing", () => {
    const write = buildPosSaleDraftWrite(
      {
        lines: [
          { kind: "ticket", packageKey: "drink", quantity: 1 },
          { kind: "custom", name: "Locker fee", amountCents: 500, reason: "Guest requested locker" }
        ],
        customerEmail: "STAFFSALE@EXAMPLE.COM",
        readerId: "tmr_reader_123",
        terminalLocationId: "tml_location_123",
        idempotencyKey: "possale_000001"
      },
      { saleRef: "SALE260704-ABC123", now, staffUserId: "staff_123", actorRole: "pos" }
    );

    expect(write.sale).toMatchObject({
      saleRef: "SALE260704-ABC123",
      subtotalCents: 4200,
      feeCents: 0,
      totalCents: 4200,
      staffUserId: "staff_123",
      customerEmailLower: "staffsale@example.com",
      readerId: "tmr_reader_123",
      terminalLocationId: "tml_location_123"
    });
    expect(write.lines).toEqual([
      expect.objectContaining({ saleRef: "SALE260704-ABC123", lineTotalCents: 3700 }),
      expect.objectContaining({ saleRef: "SALE260704-ABC123", lineTotalCents: 500 })
    ]);
  });

  it("rejects viewer pricing and POS idempotency conflicts", () => {
    const sale = {
      lines: [{ kind: "ticket" as const, packageKey: "general" as const }],
      idempotencyKey: "possale_000002"
    };

    expect(() =>
      buildPosSaleDraftWrite(sale, { saleRef: "SALE260704-ABC123", now, staffUserId: "staff_123", actorRole: "viewer" })
    ).toThrow("POS sale requires a pos or admin role");

    const first = buildPosSaleDraftWrite(sale, {
      saleRef: "SALE260704-ABC123",
      now,
      staffUserId: "staff_123",
      actorRole: "pos"
    });
    const secondFingerprint = posSaleDraftFingerprint(
      {
        lines: [{ kind: "ticket", packageKey: "drink", quantity: 1 }],
        idempotencyKey: "possale_000002"
      },
      "pos"
    );

    expect(() => assertSameDraftFingerprint(first.draftFingerprint, secondFingerprint)).toThrow(
      "idempotencyKey was already used for a different draft"
    );
  });
});
