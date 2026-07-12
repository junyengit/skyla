import { describe, expect, it } from "vitest";
import { approvedStaffApiUrl } from "./lib/staff-api-url";

const origin = "https://skydeckla.com";

describe("approvedStaffApiUrl", () => {
  it.each([
    ["/api/admin/operations?limit=12", "/api/admin/operations?limit=12"],
    ["/api/pos/readers", "/api/pos/readers"],
    ["/api/order-drafts/pos", "/api/order-drafts/pos"],
    ["/api/payments/stripe-terminal/process", "/api/payments/stripe-terminal/process"]
  ])("allows a same-origin staff endpoint", (input, expected) => {
    expect(approvedStaffApiUrl(input, origin)).toBe(expected);
  });

  it.each([
    "https://example.com/api/admin/operations",
    "//example.com/api/admin/operations",
    "/api/order-drafts/checkout",
    "/api/admin/../members/applications",
    "/admin"
  ])("rejects a non-staff or cross-origin destination", (input) => {
    expect(() => approvedStaffApiUrl(input, origin)).toThrow("approved Skyla API route");
  });
});
