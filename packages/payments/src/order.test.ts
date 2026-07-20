import { describe, expect, it } from "vitest";

import { catalogLineMetadata, ticketPackages } from "./catalog";
import { createCheckoutOrderDraft, createPosSaleDraft } from "./order";
import {
  checkoutOrderLineRecords,
  checkoutOrderRecord,
  orderRefFromId,
  posSaleLineRecords,
  posSaleRecord,
  saleRefFromId
} from "./records";

describe("createCheckoutOrderDraft", () => {
  it("calculates canonical ticket, child, addon, fee, and total cents", () => {
    const draft = createCheckoutOrderDraft({
      packageKey: "general",
      adults: 2,
      children: 1,
      addons: { matcha: 2 },
      customerEmail: "GUEST@EXAMPLE.COM"
    });

    expect(draft).toMatchObject({
      channel: "online",
      status: "draft",
      currency: "usd",
      subtotalCents: 6600,
      feeCents: 0,
      totalCents: 6600,
      customerEmail: "guest@example.com"
    });
    expect(draft.lines).toEqual([
      expect.objectContaining({
        kind: "ticket",
        productKey: "general",
        quantity: 2,
        unitAmountCents: 2000,
        metadata: catalogLineMetadata(ticketPackages.general)
      }),
      expect.objectContaining({
        kind: "ticket",
        productKey: "general",
        quantity: 1,
        unitAmountCents: 1000,
        metadata: { ...catalogLineMetadata(ticketPackages.general), childDiscountRate: 0.5 }
      }),
      expect.objectContaining({
        kind: "addon",
        productKey: "matcha",
        quantity: 2,
        unitAmountCents: 800,
        metadata: expect.objectContaining({ catalogVersion: "skyla-payments-catalog-2026-07-20" })
      })
    ]);
  });

  it("charges the advertised price with no online booking fee", () => {
    const draft = createCheckoutOrderDraft({
      packageKey: "general",
      adults: 1,
      totalCents: 1,
      amountCents: 1
    } as Parameters<typeof createCheckoutOrderDraft>[0] & { totalCents: number; amountCents: number });

    expect(draft.subtotalCents).toBe(2000);
    expect(draft.feeCents).toBe(0);
    expect(draft.totalCents).toBe(2000);
  });

  it("rejects inactive packages until they are explicitly made bookable", () => {
    expect(() => createCheckoutOrderDraft({ packageKey: "champagne-room", adults: 2 })).toThrow(
      "Ticket package is not bookable"
    );
    expect(() => createCheckoutOrderDraft({ packageKey: "drink", adults: 1 })).toThrow(
      "Ticket package is not bookable"
    );
  });
});

describe("createPosSaleDraft", () => {
  it("reprices ticket, cafe, and custom POS lines server-side", () => {
    const sale = createPosSaleDraft({
      actorRole: "pos",
      lines: [
        { kind: "ticket", packageKey: "general", quantity: 2 },
        { kind: "cafe", itemKey: "b1", quantity: 3 },
        { kind: "custom", name: "Locker fee", amountCents: 500, reason: "Guest requested locker", quantity: 1 }
      ]
    });

    expect(sale).toMatchObject({
      channel: "pos",
      currency: "usd",
      subtotalCents: 6300,
      feeCents: 0,
      totalCents: 6300
    });
    expect(sale.lines.map((line) => line.kind)).toEqual(["ticket", "cafe", "custom"]);
  });

  it("defaults omitted POS line quantities to one before calculating totals", () => {
    const sale = createPosSaleDraft({
      actorRole: "admin",
      lines: [
        { kind: "ticket", packageKey: "general" },
        { kind: "cafe", itemKey: "b1" }
      ]
    });

    expect(sale.subtotalCents).toBe(2600);
    expect(sale.lines).toEqual([
      expect.objectContaining({ kind: "ticket", quantity: 1, lineTotalCents: 2000 }),
      expect.objectContaining({ kind: "cafe", quantity: 1, lineTotalCents: 600 })
    ]);
  });

  it("rejects viewer role and custom charges without reasons", () => {
    expect(() =>
      createPosSaleDraft({
        actorRole: "viewer",
        lines: [{ kind: "ticket", packageKey: "general", quantity: 1 }]
      })
    ).toThrow("POS sale requires a pos or admin role");

    expect(() =>
      createPosSaleDraft({
        actorRole: "admin",
        lines: [{ kind: "custom", name: "Manual charge", amountCents: 500, reason: "" }]
      })
    ).toThrow("Custom charge requires a reason");
  });
});

describe("stored order records", () => {
  it("maps checkout drafts into stable order and line records", () => {
    const draft = createCheckoutOrderDraft({
      packageKey: "general",
      adults: 2,
      children: 1,
      addons: { matcha: 1 },
      customerEmail: "Guest@Example.com",
      visitDate: "2026-07-04",
      entryTime: "15:00"
    });
    const now = Date.UTC(2026, 6, 4, 12);
    const orderRef = orderRefFromId("abc123", now);
    const record = checkoutOrderRecord(draft, {
      orderRef,
      now,
      source: "unit-test",
      idempotencyKey: "idem_checkout_123",
      draftFingerprint: "v1:fingerprint"
    });
    const lines = checkoutOrderLineRecords(orderRef, draft.lines);

    expect(record).toMatchObject({
      orderRef: "SKY2607-ABC123",
      channel: "online",
      status: "draft",
      subtotalCents: 5800,
      feeCents: 0,
      totalCents: 5800,
      customerEmailLower: "guest@example.com",
      visitDate: "2026-07-04",
      entryTime: "15:00",
      source: "unit-test",
      idempotencyKey: "idem_checkout_123",
      draftFingerprint: "v1:fingerprint",
      createdAt: now,
      updatedAt: now
    });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual(
      expect.objectContaining({
        orderRef,
        kind: "ticket",
        lineTotalCents: 4000,
        metadata: catalogLineMetadata(ticketPackages.general)
      })
    );
  });

  it("maps POS drafts into staff-attributed sale and line records", () => {
    const draft = createPosSaleDraft({
      actorRole: "pos",
      lines: [
        { kind: "ticket", packageKey: "general", quantity: 1 },
        { kind: "custom", name: "Locker fee", amountCents: 500, reason: "Guest requested locker" }
      ],
      customerEmail: "STAFFSALE@EXAMPLE.COM"
    });
    const now = Date.UTC(2026, 6, 4, 12);
    const saleRef = saleRefFromId("sale-id", now);
    const record = posSaleRecord(draft, {
      saleRef,
      now,
      staffUserId: "staff_123",
      readerId: "tmr_reader_123",
      terminalLocationId: "tml_location_123",
      idempotencyKey: "idem_pos_12345",
      draftFingerprint: "v1:posfinger"
    });
    const lines = posSaleLineRecords(saleRef, draft.lines);

    expect(record).toMatchObject({
      saleRef: "SALE260704-SALEID",
      status: "draft",
      subtotalCents: 2500,
      feeCents: 0,
      totalCents: 2500,
      staffUserId: "staff_123",
      customerEmailLower: "staffsale@example.com",
      readerId: "tmr_reader_123",
      terminalLocationId: "tml_location_123",
      idempotencyKey: "idem_pos_12345",
      draftFingerprint: "v1:posfinger",
      createdAt: now,
      updatedAt: now
    });
    expect(lines).toEqual([
      expect.objectContaining({
        saleRef,
        kind: "ticket",
        lineTotalCents: 2000,
        metadata: expect.objectContaining({ catalogAuthority: "code-owned" })
      }),
      expect.objectContaining({ saleRef, kind: "custom", lineTotalCents: 500, metadata: { reason: "Guest requested locker" } })
    ]);
  });

  it("omits absent optional order fields while preserving catalog line provenance", () => {
    const draft = createCheckoutOrderDraft({ packageKey: "general", adults: 1 });
    const record = checkoutOrderRecord(draft, {
      orderRef: orderRefFromId("abc123", Date.UTC(2026, 6, 4)),
      now: 123
    });
    const [line] = checkoutOrderLineRecords(record.orderRef, draft.lines);

    expect(Object.hasOwn(record, "customerEmailLower")).toBe(false);
    expect(Object.hasOwn(record, "visitDate")).toBe(false);
    expect(Object.hasOwn(record, "entryTime")).toBe(false);
    expect(Object.hasOwn(record, "source")).toBe(false);
    expect(line.metadata).toEqual(catalogLineMetadata(ticketPackages.general));
  });
});
