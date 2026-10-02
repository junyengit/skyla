import { describe, expect, it } from "vitest";

import { addons, admissionAgeCategories, catalogLineMetadata, ticketPackages } from "./catalog";
import { admissionLineMetadata, admissionPartyCounts, createCheckoutOrderDraft, createPosSaleDraft } from "./order";
import {
  checkoutOrderLineRecords,
  checkoutOrderRecord,
  orderRefFromId,
  posSaleLineRecords,
  posSaleRecord,
  saleRefFromId
} from "./records";

describe("createCheckoutOrderDraft", () => {
  it("calculates canonical adult, youth, addon, fee, and total cents", () => {
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
        name: "The View · Adult 18+",
        quantity: 2,
        unitAmountCents: 2000,
        metadata: {
          ...catalogLineMetadata(ticketPackages.general),
          admissionPolicyVersion: "skydeck-admission-ages-2026-10-02",
          ageCategory: "adult",
          ageRange: "18+"
        }
      }),
      expect.objectContaining({
        kind: "ticket",
        productKey: "general",
        name: "The View · Youth 8–17",
        quantity: 1,
        unitAmountCents: 1000,
        metadata: {
          ...catalogLineMetadata(ticketPackages.general),
          admissionPolicyVersion: "skydeck-admission-ages-2026-10-02",
          ageCategory: "youth",
          ageRange: "8-17"
        }
      }),
      expect.objectContaining({
        kind: "addon",
        productKey: "matcha",
        quantity: 2,
        unitAmountCents: 800,
        metadata: catalogLineMetadata(addons.matcha)
      })
    ]);
    expect(draft.lines[2].metadata).not.toHaveProperty("ageCategory");
  });

  it("prices 1 adult, 2 youths, and 3 free children at $40 for a party of 6", () => {
    const draft = createCheckoutOrderDraft({ packageKey: "general", adults: 1, children: 2, freeChildren: 3 });

    expect(draft).toMatchObject({ subtotalCents: 4000, feeCents: 0, totalCents: 4000 });
    expect(draft.lines.map(({ name, quantity, unitAmountCents, lineTotalCents }) => ({
      name,
      quantity,
      unitAmountCents,
      lineTotalCents
    }))).toEqual([
      { name: "The View · Adult 18+", quantity: 1, unitAmountCents: 2000, lineTotalCents: 2000 },
      { name: "The View · Youth 8–17", quantity: 2, unitAmountCents: 1000, lineTotalCents: 2000 },
      { name: "The View · Child 0–7", quantity: 3, unitAmountCents: 0, lineTotalCents: 0 }
    ]);
    expect(draft.lines[2]).toMatchObject({
      kind: "ticket",
      productKey: "general",
      metadata: admissionLineMetadata(ticketPackages.general, admissionAgeCategories.child)
    });
    expect(draft.lines.reduce((sum, line) => sum + (line.kind === "ticket" ? line.quantity : 0), 0)).toBe(6);
    expect(admissionPartyCounts({ adults: 1, children: 2, freeChildren: 3 })).toEqual({
      adults: 1,
      children: 2,
      freeChildren: 3,
      partySize: 6
    });
  });

  it("treats omitted and zero free children identically and omits empty category lines", () => {
    const omitted = createCheckoutOrderDraft({ packageKey: "general", adults: 2 });
    const zeros = createCheckoutOrderDraft({ packageKey: "general", adults: 2, children: 0, freeChildren: 0 });

    expect(zeros).toEqual(omitted);
    expect(omitted.lines).toHaveLength(1);
    expect(omitted.lines[0]).toMatchObject({ name: "The View · Adult 18+", quantity: 2, lineTotalCents: 4000 });
  });

  it("allows a full party of 30 and rejects 31 across all ages", () => {
    expect(createCheckoutOrderDraft({ packageKey: "general", adults: 10, children: 10, freeChildren: 10 }).totalCents).toBe(
      30000
    );
    expect(createCheckoutOrderDraft({ packageKey: "general", adults: 30 }).totalCents).toBe(60000);
    expect(() => createCheckoutOrderDraft({ packageKey: "general", adults: 10, children: 10, freeChildren: 11 })).toThrow(
      "party size must be 30 visitors or fewer"
    );
    expect(() => createCheckoutOrderDraft({ packageKey: "general", adults: 1, freeChildren: 30 })).toThrow(
      "party size must be 30 visitors or fewer"
    );
  });

  it.each([
    ["fractional adults", { adults: 1.5 }, "adults must be a whole number from 1 to 30"],
    ["zero adults", { adults: 0, freeChildren: 2 }, "adults must be a whole number from 1 to 30"],
    ["negative youths", { adults: 1, children: -1 }, "children must be a whole number from 0 to 30"],
    ["fractional free children", { adults: 1, freeChildren: 0.5 }, "freeChildren must be a whole number from 0 to 30"],
    ["negative free children", { adults: 1, freeChildren: -2 }, "freeChildren must be a whole number from 0 to 30"],
    ["infinite free children", { adults: 1, freeChildren: Number.POSITIVE_INFINITY }, "freeChildren must be a whole number from 0 to 30"],
    ["NaN youths", { adults: 1, children: Number.NaN }, "children must be a whole number from 0 to 30"],
    ["numeric-string free children", { adults: 1, freeChildren: "2" }, "freeChildren must be a whole number from 0 to 30"],
    ["one category over 30", { adults: 31 }, "adults must be a whole number from 1 to 30"],
    ["unsafe integer", { adults: 1, freeChildren: Number.MAX_SAFE_INTEGER + 1 }, "freeChildren must be a whole number from 0 to 30"]
  ])("rejects %s", (_label, counts, message) => {
    expect(() =>
      createCheckoutOrderDraft({ packageKey: "general", ...counts } as Parameters<typeof createCheckoutOrderDraft>[0])
    ).toThrow(message);
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
        metadata: admissionLineMetadata(ticketPackages.general, admissionAgeCategories.adult)
      })
    );
  });

  it("persists free children as a zero-priced ticket line record", () => {
    const draft = createCheckoutOrderDraft({ packageKey: "general", adults: 1, freeChildren: 2 });
    const orderRef = orderRefFromId("free123", Date.UTC(2026, 9, 2));
    const lines = checkoutOrderLineRecords(orderRef, draft.lines);

    expect(lines).toEqual([
      expect.objectContaining({ orderRef, kind: "ticket", quantity: 1, lineTotalCents: 2000 }),
      expect.objectContaining({
        orderRef,
        kind: "ticket",
        productKey: "general",
        name: "The View · Child 0–7",
        quantity: 2,
        unitAmountCents: 0,
        lineTotalCents: 0,
        metadata: expect.objectContaining({ ageCategory: "child", ageRange: "0-7" })
      })
    ]);
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
        name: "The View",
        lineTotalCents: 2000,
        metadata: catalogLineMetadata(ticketPackages.general)
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
    expect(line.metadata).toEqual(admissionLineMetadata(ticketPackages.general, admissionAgeCategories.adult));
  });
});
