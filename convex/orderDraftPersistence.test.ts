import { describe, expect, it } from "vitest";
import {
  addons,
  admissionAgeCategories,
  admissionLineMetadata,
  cafeItems,
  catalogLineMetadata,
  ticketPackages
} from "@skyla/payments";

import {
  assertSameDraftFingerprint,
  assertStoredPaymentLineProvenance,
  buildCheckoutDraftWrite,
  buildPosSaleDraftWrite,
  checkoutDraftFingerprint,
  checkoutDraftResult,
  normalizeCheckoutDraftArgs,
  posSaleDraftFingerprint
} from "./lib/orderDraftPersistence";

const now = Date.UTC(2026, 6, 4, 12);
const catalogMetadata = {
  catalogVersion: "skyla-payments-catalog-2026-10-02",
  catalogSource: "@skyla/payments",
  catalogAuthority: "code-owned",
  catalogContentHash: expect.stringMatching(/^fnv1a32:/)
};

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
      subtotalCents: 5800,
      feeCents: 0,
      totalCents: 5800,
      customerEmailLower: "guest@example.com",
      idempotencyKey: "checkout_000001",
      source: "convex"
    });
    expect(write.lines).toHaveLength(3);
    expect(write.lines[0]).toEqual(expect.objectContaining({ orderRef: "SKY2607-ABC123", lineTotalCents: 4000 }));
    expect(write.lines.map((line) => line.metadata)).toEqual([
      admissionLineMetadata(ticketPackages.general, admissionAgeCategories.adult),
      admissionLineMetadata(ticketPackages.general, admissionAgeCategories.youth),
      catalogLineMetadata(addons.matcha)
    ]);
  });

  it("persists free children as a zero-priced ticket line and normalizes them into the fingerprint", () => {
    const write = buildCheckoutDraftWrite(
      { packageKey: "general", adults: 1, children: 2, freeChildren: 3, idempotencyKey: "checkout_free_0001" },
      { orderRef: "SKY2610-FREE01", now }
    );

    expect(write.input).toMatchObject({ adults: 1, children: 2, freeChildren: 3 });
    expect(write.order).toMatchObject({ subtotalCents: 4000, feeCents: 0, totalCents: 4000 });
    expect(write.lines.map(({ name, quantity, unitAmountCents, lineTotalCents }) => ({
      name,
      quantity,
      unitAmountCents,
      lineTotalCents
    }))).toEqual([
      { name: "The View · Adult 18+", quantity: 1, unitAmountCents: 2000, lineTotalCents: 2000 },
      { name: "The View · Youth 8–17", quantity: 2, unitAmountCents: 1000, lineTotalCents: 2000 },
      { name: "The View · Child 0–7", quantity: 3, unitAmountCents: 0, lineTotalCents: 0 }
    ]);
    expect(write.lines[2]).toMatchObject({
      orderRef: "SKY2610-FREE01",
      kind: "ticket",
      productKey: "general",
      metadata: admissionLineMetadata(ticketPackages.general, admissionAgeCategories.child)
    });
    expect(write.draftFingerprint).toContain('"freeChildren":3');
    expect(() => assertStoredPaymentLineProvenance(write.lines, "Checkout")).not.toThrow();
  });

  it("rejects idempotency reuse when only the free child count changes", () => {
    const first = buildCheckoutDraftWrite(
      { packageKey: "general", adults: 1, freeChildren: 1, idempotencyKey: "checkout_free_0002" },
      { orderRef: "SKY2610-FREE02", now }
    );
    const second = buildCheckoutDraftWrite(
      { packageKey: "general", adults: 1, freeChildren: 2, idempotencyKey: "checkout_free_0002" },
      { orderRef: "SKY2610-FREE02", now }
    );

    expect(first.order.totalCents).toBe(second.order.totalCents);
    expect(() => assertSameDraftFingerprint(first.draftFingerprint, second.draftFingerprint)).toThrow(
      "idempotencyKey was already used for a different draft"
    );
  });

  it("keeps omitted and zero free children equivalent to the pre-existing fingerprint", () => {
    const omitted = normalizeCheckoutDraftArgs({ packageKey: "general", adults: 2, idempotencyKey: "checkout_free_0003" });
    const zero = normalizeCheckoutDraftArgs({
      packageKey: "general",
      adults: 2,
      freeChildren: 0,
      idempotencyKey: "checkout_free_0003"
    });

    expect(zero).toEqual(omitted);
    expect(zero).not.toHaveProperty("freeChildren");
    expect(checkoutDraftFingerprint(zero)).toBe(checkoutDraftFingerprint(omitted));
    expect(checkoutDraftFingerprint(omitted)).toBe('v1:{"adults":2,"packageKey":"general"}');
  });

  it.each([
    ["fractional free children", { adults: 1, freeChildren: 1.5 }, "freeChildren must be a whole number from 0 to 30"],
    ["negative free children", { adults: 1, freeChildren: -1 }, "freeChildren must be a whole number from 0 to 30"],
    ["infinite youths", { adults: 1, children: Number.POSITIVE_INFINITY }, "children must be a whole number from 0 to 30"],
    ["NaN adults", { adults: Number.NaN }, "adults must be a whole number from 1 to 30"],
    ["31 visitors", { adults: 20, children: 5, freeChildren: 6 }, "party size must be 30 visitors or fewer"]
  ])("rejects %s in normalized Convex draft input", (_label, counts, message) => {
    expect(() =>
      normalizeCheckoutDraftArgs({
        packageKey: "general",
        idempotencyKey: "checkout_free_0004",
        ...counts
      } as Parameters<typeof normalizeCheckoutDraftArgs>[0])
    ).toThrow(message);
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
      { packageKey: "general", adults: 2, idempotencyKey: "checkout_000003" },
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
      name: "The View · Adult 18+",
      quantity: 1,
      unitAmountCents: 2000,
      lineTotalCents: 2000,
      metadata: {
        ...catalogMetadata,
        admissionPolicyVersion: "skydeck-admission-ages-2026-10-02",
        ageCategory: "adult",
        ageRange: "18+"
      }
    });
  });

  it("accepts payment snapshots only when catalog-priced checkout lines keep provenance", () => {
    const write = buildCheckoutDraftWrite(
      { packageKey: "general", adults: 1, children: 1, idempotencyKey: "checkout_000007" },
      { orderRef: "SKY2607-ABC123", now }
    );

    expect(() => assertStoredPaymentLineProvenance(write.lines, "Checkout")).not.toThrow();

    expect(() =>
      assertStoredPaymentLineProvenance([{ ...write.lines[0], metadata: undefined }], "Checkout")
    ).toThrow("Checkout line 1 is missing catalog provenance metadata");

    expect(() =>
      assertStoredPaymentLineProvenance(
        [
          {
            ...write.lines[0],
            metadata: { ...write.lines[0].metadata, catalogContentHash: "fnv1a32:00000000:92" }
          }
        ],
        "Checkout"
      )
    ).toThrow("Checkout line 1 has mismatched catalog provenance: catalogContentHash");
  });

  it("rejects stored admission lines whose age category, price, or name was altered", () => {
    const write = buildCheckoutDraftWrite(
      { packageKey: "general", adults: 1, children: 1, freeChildren: 1, idempotencyKey: "checkout_000008" },
      { orderRef: "SKY2607-ABC123", now }
    );
    const [adult, youth, child] = write.lines;

    expect(() =>
      assertStoredPaymentLineProvenance([{ ...youth, metadata: { ...youth.metadata, ageCategory: "child" } }], "Checkout")
    ).toThrow("Checkout line 1 has mismatched admission age metadata: ageRange");
    expect(() =>
      assertStoredPaymentLineProvenance(
        [{ ...adult, unitAmountCents: 0, lineTotalCents: 0, metadata: { ...adult.metadata, ageCategory: "child", ageRange: "0-7" } }],
        "Checkout"
      )
    ).toThrow("Checkout line 1 name does not match the code-owned catalog");
    expect(() =>
      assertStoredPaymentLineProvenance([{ ...child, unitAmountCents: 1, lineTotalCents: 1 }], "Checkout")
    ).toThrow("Checkout line 1 price does not match the code-owned catalog");
    expect(() =>
      assertStoredPaymentLineProvenance(
        [{ ...child, metadata: { ...child.metadata, ageCategory: "toString" } }],
        "Checkout"
      )
    ).toThrow("Checkout line 1 has an unknown admission age category");
    expect(() =>
      assertStoredPaymentLineProvenance(
        [{ ...youth, metadata: { ...youth.metadata, childDiscountRate: 0.5 } }],
        "Checkout"
      )
    ).toThrow("Checkout line 1 has retired child discount metadata");
    expect(() =>
      assertStoredPaymentLineProvenance(
        [
          {
            kind: "addon",
            productKey: "matcha",
            name: "Ceremonial Matcha Latte",
            quantity: 1,
            unitAmountCents: 800,
            lineTotalCents: 800,
            metadata: { ...catalogLineMetadata(addons.matcha), ageCategory: "child" }
          }
        ],
        "Checkout"
      )
    ).toThrow("Checkout line 1 has admission age metadata on a non-ticket line");
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
          adults: 31,
          entryTime: "25:00",
          customerEmail: "not-an-email",
          idempotencyKey: "checkout_000005"
        },
        { orderRef: "SKY2607-ABC123", now }
      )
    ).toThrow("adults must be a whole number from 1 to 30");

    expect(() =>
      buildCheckoutDraftWrite(
        { packageKey: "general", adults: 1, entryTime: "25:00", idempotencyKey: "checkout_000005" },
        { orderRef: "SKY2607-ABC123", now }
      )
    ).toThrow("entryTime must use HH:mm");
  });

  it("builds staff-attributed POS sale docs with role-derived pricing", () => {
    const write = buildPosSaleDraftWrite(
      {
        lines: [
          { kind: "ticket", packageKey: "general", quantity: 1 },
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
      subtotalCents: 2500,
      feeCents: 0,
      totalCents: 2500,
      staffUserId: "staff_123",
      customerEmailLower: "staffsale@example.com",
      readerId: "tmr_reader_123",
      terminalLocationId: "tml_location_123"
    });
    expect(write.lines).toEqual([
      expect.objectContaining({
        saleRef: "SALE260704-ABC123",
        lineTotalCents: 2000,
        metadata: catalogLineMetadata(ticketPackages.general)
      }),
      expect.objectContaining({ saleRef: "SALE260704-ABC123", lineTotalCents: 500 })
    ]);
    expect(write.lines[1].metadata).toEqual({ reason: "Guest requested locker" });
    expect(write.lines[1].metadata).not.toHaveProperty("catalogAuthority");
  });

  it("persists cafe catalog provenance without adding it to custom POS lines", () => {
    const write = buildPosSaleDraftWrite(
      {
        lines: [
          { kind: "cafe", itemKey: "b1", quantity: 2 },
          { kind: "custom", name: "Comped cover adjustment", amountCents: 500, reason: "Manager approved" }
        ],
        idempotencyKey: "possale_000004"
      },
      { saleRef: "SALE260704-DEF456", now, staffUserId: "staff_123", actorRole: "admin" }
    );

    expect(write.lines[0]).toEqual(
      expect.objectContaining({
        kind: "cafe",
        productKey: "b1",
        metadata: catalogLineMetadata(cafeItems.b1)
      })
    );
    expect(write.lines[1].metadata).toEqual({ reason: "Manager approved" });
  });

  it("accepts POS custom payment lines without catalog provenance and rejects catalog spoofing", () => {
    const write = buildPosSaleDraftWrite(
      {
        lines: [
          { kind: "cafe", itemKey: "b1", quantity: 1 },
          { kind: "custom", name: "Locker fee", amountCents: 500, reason: "Guest requested locker" }
        ],
        idempotencyKey: "possale_000005"
      },
      { saleRef: "SALE260704-ABC123", now, staffUserId: "staff_123", actorRole: "pos" }
    );

    expect(() => assertStoredPaymentLineProvenance(write.lines, "POS Terminal")).not.toThrow();

    expect(() =>
      assertStoredPaymentLineProvenance(
        [
          {
            ...write.lines[1],
            metadata: { ...catalogLineMetadata(cafeItems.b1), reason: "Guest requested locker" }
          }
        ],
        "POS Terminal"
      )
    ).toThrow("POS Terminal line 1 is custom but includes catalog provenance metadata");
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
