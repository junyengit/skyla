import { describe, expect, it } from "vitest";
import { listTicketPackages } from "@skyla/payments";

import { siteConfig, ticketPackages } from "./index";

describe("siteConfig", () => {
  it("keeps public contact and domain values canonical", () => {
    expect(siteConfig.name).toBe("Sky LA");
    expect(siteConfig.domain).toBe("skydeckla.com");
    expect(siteConfig.email).toMatch(/@skydeckla\.com$/);
    expect(siteConfig.address.full).toContain("6100 Wilshire Blvd");
  });

  it("keeps the pre-launch gate and canonical status copy", () => {
    expect(siteConfig.launched).toBe(false);
    expect(siteConfig.launchStatus).toEqual({
      label: "Coming soon",
      message: "Sky LA is not open yet. Ticket sales are not live."
    });
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
        name: "The View",
        price: 20,
        priceCents: 2000
      })
    ]);
  });

  it("derives public ticket prices from the payment catalog", () => {
    expect(
      ticketPackages.map((ticketPackage) => ({
        key: ticketPackage.key,
        priceCents: ticketPackage.priceCents
      }))
    ).toEqual(
      listTicketPackages().map((ticketPackage) => ({
        key: ticketPackage.key,
        priceCents: ticketPackage.priceCents
      }))
    );
  });
});
