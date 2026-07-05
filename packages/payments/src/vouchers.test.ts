import { describe, expect, it } from "vitest";

import {
  buildVoucherEntitlements,
  projectVoucherRedemption,
  summarizeVoucherEntitlements
} from "./vouchers";

describe("voucher entitlements", () => {
  it("turns drink package guests and add-ons into redeemable vouchers", () => {
    const entitlements = buildVoucherEntitlements({
      packageKey: "drink",
      adults: 2,
      children: 1,
      addonQuantities: { matcha: 2 },
      redemptionTotals: { "pkg-0": 1, "addon-matcha": 2 }
    });

    expect(entitlements).toEqual([
      {
        id: "pkg-0",
        label: "Coffee or Matcha (your choice)",
        quantity: 3,
        redeemed: 1,
        remaining: 2,
        source: "package",
        packageKey: "drink"
      },
      {
        id: "addon-matcha",
        label: "Ceremonial Matcha Latte",
        quantity: 2,
        redeemed: 2,
        remaining: 0,
        source: "addon",
        addonKey: "matcha"
      }
    ]);
    expect(summarizeVoucherEntitlements(entitlements)).toEqual({ total: 5, redeemed: 3, remaining: 2 });
  });

  it("uses order-line package quantities when present", () => {
    expect(
      buildVoucherEntitlements({
        packageQuantities: { drink: 4, general: 3 },
        addonQuantities: { custom: 1 },
        addonLabels: { custom: "Manual Cafe Credit" }
      })
    ).toEqual([
      {
        id: "pkg-0",
        label: "Coffee or Matcha (your choice)",
        quantity: 4,
        redeemed: 0,
        remaining: 4,
        source: "package",
        packageKey: "drink"
      },
      {
        id: "addon-custom",
        label: "Manual Cafe Credit",
        quantity: 1,
        redeemed: 0,
        remaining: 1,
        source: "addon",
        addonKey: "custom"
      }
    ]);
  });

  it("clamps displayed redemptions to the entitlement quantity", () => {
    expect(
      buildVoucherEntitlements({
        packageKey: "drink",
        partySize: 1,
        redemptionTotals: { "pkg-0": 4 }
      })[0]
    ).toMatchObject({ quantity: 1, redeemed: 1, remaining: 0 });
  });

  it("rejects voucher redemptions above or below entitlement", () => {
    const entitlements = buildVoucherEntitlements({
      addonQuantities: { matcha: 1 },
      redemptionTotals: { "addon-matcha": 1 }
    });

    expect(() => projectVoucherRedemption(entitlements, "addon-matcha", 1)).toThrow("fully redeemed");
    expect(() => projectVoucherRedemption(entitlements, "missing", 1)).toThrow("not found");
    expect(projectVoucherRedemption(entitlements, "addon-matcha", -1)).toEqual({
      voucherId: "addon-matcha",
      label: "Ceremonial Matcha Latte",
      fromRedeemed: 1,
      toRedeemed: 0,
      quantity: 1
    });
    expect(() =>
      projectVoucherRedemption(
        buildVoucherEntitlements({
          addonQuantities: { matcha: 1 }
        }),
        "addon-matcha",
        -1
      )
    ).toThrow("no redemptions");
  });
});
