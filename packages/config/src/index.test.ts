import { describe, expect, it } from "vitest";

import { siteConfig, ticketPackages } from "./index";

describe("siteConfig", () => {
  it("keeps public contact and domain values canonical", () => {
    expect(siteConfig.name).toBe("Sky LA");
    expect(siteConfig.domain).toBe("skydeckla.com");
    expect(siteConfig.email).toMatch(/@skydeckla\.com$/);
    expect(siteConfig.address.full).toContain("6100 Wilshire Blvd");
  });
});

describe("ticketPackages", () => {
  it("keeps package keys unique and prices server-ready", () => {
    const keys = ticketPackages.map((ticketPackage) => ticketPackage.key);
    expect(new Set(keys).size).toBe(keys.length);

    for (const ticketPackage of ticketPackages) {
      expect(ticketPackage.price).toBeGreaterThan(0);
      expect(Number.isInteger(ticketPackage.price)).toBe(true);
      expect(ticketPackage.description.length).toBeGreaterThan(20);
    }
  });

  it("keeps current public ticket prices stable", () => {
    expect(ticketPackages).toEqual([
      expect.objectContaining({
        key: "general",
        name: "General Admission",
        price: 29
      }),
      expect.objectContaining({
        key: "drink",
        name: "Deck + Drink",
        price: 37
      })
    ]);
  });
});
