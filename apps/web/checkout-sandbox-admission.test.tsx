// @vitest-environment happy-dom

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { siteConfig } from "@skyla/config";

import CheckoutPage from "./app/checkout/page";

vi.mock("./lib/public-operating-config", () => ({
  loadPublicOperatingConfig: vi.fn(async () => null)
}));

// Test fixture only: shaped like Junyen's Vercel Git-branch hosts. It is not
// the deployed Preview hostname, which the source never guesses.
const fixtureBranchHost = "skyla-git-sandbox-fixture-jaky.vercel.app";
const fixtureOrigin = `https://${fixtureBranchHost}`;
const sandboxNotice = "Test checkout. No real money is charged.";

const verifiedEnv: Record<string, string> = {
  NODE_ENV: "production",
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_TARGET_ENV: "preview",
  VERCEL_PROJECT_ID: "prj_9kHRLLx98IDDFlvparVhBDPtIpFt",
  VERCEL_GIT_COMMIT_REF: "codex/skydeck-sandbox-gate-20261003",
  VERCEL_BRANCH_URL: fixtureBranchHost,
  VERCEL_URL: "web-a1b2c3d4e-jaky.vercel.app",
  VERCEL_PROJECT_PRODUCTION_URL: "skydeckla.com",
  SKYLA_SANDBOX_ADMISSION: "bold-reindeer-495",
  SKYLA_SANDBOX_ADMISSION_ORIGIN: fixtureOrigin,
  SKYLA_PUBLIC_ORIGIN: fixtureOrigin,
  SKYLA_STRIPE_MODE: "test",
  SKYLA_LOCAL_ADMISSION_PREVIEW: "",
  CONVEX_SITE_URL: "https://bold-reindeer-495.convex.site",
  CONVEX_URL: "",
  NEXT_PUBLIC_CONVEX_URL: "https://bold-reindeer-495.convex.cloud"
};

function stubEnv(overrides: Record<string, string> = {}) {
  for (const [key, value] of Object.entries({ ...verifiedEnv, ...overrides })) vi.stubEnv(key, value);
}

async function renderPage(params: Record<string, string> = {}) {
  return renderToStaticMarkup(await CheckoutPage({ searchParams: Promise.resolve(params) }));
}

function expectPrelaunch(html: string) {
  expect(html).toContain("Online ticket purchasing is not enabled here yet.");
  expect(html).toContain('class="launchBanner"');
  expect(html).toContain("Request full-venue availability");
  expect(html).toContain('href="/#venue-booking"');
  expect(html).not.toContain(sandboxNotice);
  expect(html).not.toContain("<legend>Visitors</legend>");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-10-10T18:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("checkout in the verified sandbox Preview", () => {
  it("renders the existing checkout with exactly one plain test notice", async () => {
    expect(siteConfig.launched).toBe(false);
    stubEnv();

    const html = await renderPage();

    expect(html.match(/Test checkout\. No real money is charged\./g)).toHaveLength(1);
    expect(html).toContain(`<p class="checkoutPreviewNotice" role="note">${sandboxNotice}</p>`);
    expect(html.indexOf(sandboxNotice)).toBeLessThan(html.indexOf("<h1>Checkout</h1>"));
    expect(html).toContain("<legend>Visitors</legend>");
    expect(html).toContain("Adult 18+ $20, Youth 8–17 $10, Child 0–7 free.");
    expect(html).toContain('href="/#venue-booking"');
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain('class="launchBanner"');
    expect(html).not.toContain("Local preview only");
    expect(html).not.toMatch(/paid admission|real ticket/i);
  });

  it("keeps the notice on the Stripe return view", async () => {
    stubEnv();

    const html = await renderPage({ stripe: "success", session_id: "cs_test_sandbox_fixture" });

    expect(html.match(/Test checkout\. No real money is charged\./g)).toHaveLength(1);
  });

  it.each([
    ["Vercel production", { VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production" }],
    ["no opt-in", { SKYLA_SANDBOX_ADMISSION: "" }],
    ["the revoked October 3 Preview", { CONVEX_SITE_URL: "https://grand-ferret-807.convex.site", NEXT_PUBLIC_CONVEX_URL: "https://grand-ferret-807.convex.cloud" }],
    ["the original Production backend", { CONVEX_SITE_URL: "https://perceptive-fox-396.convex.site", NEXT_PUBLIC_CONVEX_URL: "https://perceptive-fox-396.convex.cloud" }],
    ["Stripe live mode", { SKYLA_STRIPE_MODE: "live" }],
    ["an unapproved origin", { SKYLA_SANDBOX_ADMISSION_ORIGIN: "https://skydeckla.com" }]
  ])("keeps the existing pre-launch page on %s", async (_label, overrides) => {
    stubEnv(overrides);
    expectPrelaunch(await renderPage());
  });

  it("returns to the pre-launch page at the reviewed cutoff", async () => {
    stubEnv();
    vi.setSystemTime(Date.parse("2026-10-12T04:00:00Z"));
    expectPrelaunch(await renderPage());
  });

  it("keeps the local visual preview visual-only and unchanged", async () => {
    stubEnv({ NODE_ENV: "development", VERCEL: "", SKYLA_LOCAL_ADMISSION_PREVIEW: "1" });

    const html = await renderPage();

    expect(html.match(/Local preview only/g)).toHaveLength(1);
    expect(html).not.toContain(sandboxNotice);
  });
});
