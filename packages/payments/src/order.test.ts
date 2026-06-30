import { describe, expect, it } from "vitest";

import { createCheckoutOrderDraft, createPosSaleDraft } from "./order";

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
      subtotalCents: 8900,
      feeCents: 445,
      totalCents: 9345,
      customerEmail: "guest@example.com"
    });
    expect(draft.lines).toEqual([
      expect.objectContaining({ kind: "ticket", productKey: "general", quantity: 2, unitAmountCents: 2900 }),
      expect.objectContaining({ kind: "ticket", productKey: "general", quantity: 1, unitAmountCents: 1500 }),
      expect.objectContaining({ kind: "addon", productKey: "matcha", quantity: 2, unitAmountCents: 800 })
    ]);
  });

  it("ignores browser-supplied totals by only accepting selections", () => {
    const draft = createCheckoutOrderDraft({
      packageKey: "drink",
      adults: 1,
      totalCents: 1,
      amountCents: 1
    } as Parameters<typeof createCheckoutOrderDraft>[0] & { totalCents: number; amountCents: number });

    expect(draft.subtotalCents).toBe(3700);
    expect(draft.feeCents).toBe(185);
    expect(draft.totalCents).toBe(3885);
  });

  it("rejects inactive premium packages until they are explicitly made bookable", () => {
    expect(() => createCheckoutOrderDraft({ packageKey: "champagne-room", adults: 2 })).toThrow(
      "Ticket package is not bookable"
    );
  });
});

describe("createPosSaleDraft", () => {
  it("reprices ticket, cafe, and custom POS lines server-side", () => {
    const sale = createPosSaleDraft({
      actorRole: "pos",
      lines: [
        { kind: "ticket", packageKey: "drink", quantity: 2 },
        { kind: "cafe", itemKey: "b1", quantity: 3 },
        { kind: "custom", name: "Locker fee", amountCents: 500, reason: "Guest requested locker", quantity: 1 }
      ]
    });

    expect(sale).toMatchObject({
      channel: "pos",
      currency: "usd",
      subtotalCents: 9700,
      feeCents: 0,
      totalCents: 9700
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

    expect(sale.subtotalCents).toBe(3500);
    expect(sale.lines).toEqual([
      expect.objectContaining({ kind: "ticket", quantity: 1, lineTotalCents: 2900 }),
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
