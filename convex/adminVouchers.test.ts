import { describe, expect, it } from "vitest";

import { buildAdminBookingVouchers, voucherRedemptionTotals } from "./lib/adminVouchers";

describe("admin booking vouchers", () => {
  it("derives native vouchers from order lines and ledger events", () => {
    const vouchers = buildAdminBookingVouchers(
      {},
      [
        { kind: "ticket", productKey: "drink", name: "Deck + Drink", quantity: 2 },
        { kind: "addon", productKey: "matcha", name: "Ceremonial Matcha Latte", quantity: 1 }
      ],
      [
        { voucherId: "pkg-0", delta: 1 },
        { voucherId: "addon-matcha", delta: 1 }
      ]
    );

    expect(vouchers.summary).toEqual({ total: 3, redeemed: 2, remaining: 1 });
    expect(vouchers.items.map((item) => [item.id, item.quantity, item.redeemed])).toEqual([
      ["pkg-0", 2, 1],
      ["addon-matcha", 1, 1]
    ]);
  });

  it("falls back to read-only legacy booking data when no native order lines exist", () => {
    const vouchers = buildAdminBookingVouchers(
      {
        rawLegacy: {
          packageKey: "drink",
          adults: "2",
          children: 1,
          addons: { pourover: "2" },
          redemptions: { "pkg-0": 1 }
        }
      },
      [],
      [{ voucherId: "addon-pourover", delta: 1 }]
    );

    expect(vouchers.summary).toEqual({ total: 5, redeemed: 2, remaining: 3 });
    expect(vouchers.items.map((item) => [item.id, item.quantity, item.redeemed])).toEqual([
      ["pkg-0", 3, 1],
      ["addon-pourover", 2, 1]
    ]);
  });

  it("combines legacy redemption baselines with event deltas without going negative", () => {
    expect(
      voucherRedemptionTotals({ redemptions: { "pkg-0": 1 } }, [
        { voucherId: "pkg-0", delta: -1 },
        { voucherId: "pkg-0", delta: -1 }
      ])
    ).toEqual({});
  });
});
