import { describe, expect, it } from "vitest";

import {
  addons,
  admissionAgeCategories,
  admissionAgeCategoryForAge,
  admissionPolicy,
  cafeItems,
  catalogItemContentHash,
  catalogLineMetadata,
  catalogProvenance,
  listAddons,
  listCafeItems,
  listCatalogItems,
  listTicketPackages,
  ticketPackages
} from "./catalog";

describe("catalog helpers", () => {
  it("exposes code-owned catalog provenance for admin and docs", () => {
    expect(catalogProvenance).toEqual({
      version: "skyla-payments-catalog-2026-10-02",
      source: "@skyla/payments",
      authority: "code-owned",
      editableInAdmin: false
    });
  });

  it("records the owner-confirmed admission age policy", () => {
    expect(admissionPolicy).toMatchObject({
      version: "skydeck-admission-ages-2026-10-02",
      packageKey: "general",
      maxPartySize: 30,
      minAdults: 1,
      bookingFeeCents: 0
    });
    expect(Object.values(admissionAgeCategories).map(({ key, label, priceCents, partyField }) => ({
      key,
      label,
      priceCents,
      partyField
    }))).toEqual([
      { key: "adult", label: "Adult 18+", priceCents: 2000, partyField: "adults" },
      { key: "youth", label: "Youth 8–17", priceCents: 1000, partyField: "children" },
      { key: "child", label: "Child 0–7", priceCents: 0, partyField: "freeChildren" }
    ]);
    expect(ticketPackages.general.priceCents).toBe(admissionAgeCategories.adult.priceCents);
    expect(ticketPackages.general.admissionPolicyVersion).toBe(admissionPolicy.version);
  });

  it("maps ages to admission categories at the 7/8 and 17/18 boundaries", () => {
    expect(admissionAgeCategoryForAge(0).key).toBe("child");
    expect(admissionAgeCategoryForAge(7)).toMatchObject({ key: "child", priceCents: 0 });
    expect(admissionAgeCategoryForAge(8)).toMatchObject({ key: "youth", priceCents: 1000 });
    expect(admissionAgeCategoryForAge(17)).toMatchObject({ key: "youth", priceCents: 1000 });
    expect(admissionAgeCategoryForAge(18)).toMatchObject({ key: "adult", priceCents: 2000 });

    for (const age of [-1, 7.5, Number.NaN, Number.POSITIVE_INFINITY, 131]) {
      expect(() => admissionAgeCategoryForAge(age)).toThrow("age must be a whole number of years from 0 to 130");
    }
  });

  it("returns active ticket, add-on, and cafe items by default", () => {
    expect(listTicketPackages().map((item) => item.key)).toEqual(["general"]);
    expect(listAddons().map((item) => item.key)).toEqual(Object.keys(addons));
    expect(listCafeItems().map((item) => item.key)).toEqual(Object.keys(cafeItems));
  });

  it("can include inactive catalog items for admin parity displays", () => {
    const allTickets = listTicketPackages({ activeOnly: false });

    expect(allTickets.map((item) => item.key)).toEqual(Object.keys(ticketPackages));
    expect(allTickets.some((item) => !item.active)).toBe(true);
  });

  it("keeps the combined catalog ordered by ticket, add-on, then cafe", () => {
    expect(listCatalogItems({ activeOnly: false }).map((item) => `${item.kind}:${item.key}`)).toEqual([
      ...Object.values(ticketPackages).map((item) => `ticket:${item.key}`),
      ...Object.values(addons).map((item) => `addon:${item.key}`),
      ...Object.values(cafeItems).map((item) => `cafe:${item.key}`)
    ]);
  });

  it("creates stable line provenance for catalog-priced items", () => {
    // The admission ticket hash now covers the age policy; add-on and cafe
    // hashes are unchanged because their content and prices did not change.
    expect(catalogItemContentHash(ticketPackages.general)).toBe("fnv1a32:fb9f7bdf:241");
    expect(catalogLineMetadata(ticketPackages.general)).toEqual({
      catalogVersion: "skyla-payments-catalog-2026-10-02",
      catalogSource: "@skyla/payments",
      catalogAuthority: "code-owned",
      catalogContentHash: "fnv1a32:fb9f7bdf:241"
    });
    expect(catalogItemContentHash(addons.matcha)).toBe("fnv1a32:ef7db060:95");
    expect(catalogItemContentHash(cafeItems.b1)).toBe("fnv1a32:b86957e2:102");
  });

  it("keeps add-on, cafe, and inactive package prices unchanged by the admission policy", () => {
    expect(listAddons({ activeOnly: false }).map((item) => [item.key, item.priceCents])).toEqual([
      ["matcha", 800],
      ["pourover", 800],
      ["hojicha", 800],
      ["coldbrew", 800]
    ]);
    expect(cafeItems.b1.priceCents).toBe(600);
    expect(cafeItems.m2.priceCents).toBe(1800);
    expect(ticketPackages.drink).not.toHaveProperty("admissionPolicyVersion");
    expect(ticketPackages["date-night"]).toMatchObject({ priceCents: 9800, minAdults: 2 });
  });
});
