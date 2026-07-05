import { describe, expect, it } from "vitest";

import {
  addons,
  cafeItems,
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
      version: "skyla-payments-catalog-2026-07-05",
      source: "@skyla/payments",
      authority: "code-owned",
      editableInAdmin: false
    });
  });

  it("returns active ticket, add-on, and cafe items by default", () => {
    expect(listTicketPackages().map((item) => item.key)).toEqual(["general", "drink"]);
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
});
