import { sandboxAdmission } from "@skyla/config";
import { describe, expect, it } from "vitest";
import { ticketCodeFromStaffLookup } from "./lib/ticketLookup";

const code = `tkt_${"a".repeat(32)}`;
const origin = `https://skyla-git-${"a".repeat(48)}-jaky.vercel.app`;
const beforeExpiry = sandboxAdmission.closesAt - 1000;
const sandboxEnv = {
  SKYLA_SANDBOX_ADMISSION: sandboxAdmission.deployment,
  CONVEX_CLOUD_URL: sandboxAdmission.convexCloudUrl,
  CONVEX_SITE_URL: sandboxAdmission.convexSiteUrl,
  SKYLA_STRIPE_MODE: "test",
  STRIPE_SECRET_KEY: "sk_test_...",
  SKYLA_SANDBOX_ADMISSION_ORIGIN: origin,
  SKYLA_PUBLIC_ORIGIN: origin,
  SKYLA_PAYMENT_RETURN_ORIGINS: origin
};

describe("staff QR lookup origins", () => {
  it("keeps production URLs and bare codes usable without sandbox configuration", () => {
    expect(ticketCodeFromStaffLookup(code.toUpperCase(), {})).toBe(code);
    expect(ticketCodeFromStaffLookup(`https://skydeckla.com/tickets/${code}/`, {})).toBe(code);
  });

  it("recognizes the exact verified sandbox URL, including long branch hosts", () => {
    const url = `${origin}/tickets/${code}`;
    expect(url.length).toBeGreaterThan(120);
    expect(url.length).toBeLessThan(200);
    expect(ticketCodeFromStaffLookup(url, sandboxEnv, beforeExpiry)).toBe(code);
  });

  it.each([
    `${origin}.evil.example/tickets/${code}`,
    `https://skyla-git-other-jaky.vercel.app/tickets/${code}`,
    `${origin}/tickets/${code}?redirect=other`,
    `${origin}/tickets/${code}#fragment`,
    `${origin}/tickets/${code}/qr`,
    `https://user@${origin.slice(8)}/tickets/${code}`,
    `http://${origin.slice(8)}/tickets/${code}`
  ])("rejects an unapproved QR URL: %s", url => {
    expect(ticketCodeFromStaffLookup(url, sandboxEnv, beforeExpiry)).toBeUndefined();
  });

  it("rejects sandbox URLs after expiry, without opt-in, or with live Stripe mode", () => {
    const url = `${origin}/tickets/${code}`;
    expect(ticketCodeFromStaffLookup(url, sandboxEnv, sandboxAdmission.closesAt)).toBeUndefined();
    expect(ticketCodeFromStaffLookup(url, {}, beforeExpiry)).toBeUndefined();
    expect(ticketCodeFromStaffLookup(url, { ...sandboxEnv, SKYLA_STRIPE_MODE: "live" }, beforeExpiry)).toBeUndefined();
  });
});
