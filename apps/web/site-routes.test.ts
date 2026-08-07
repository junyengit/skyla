import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import robots from "./app/robots";
import sitemap from "./app/sitemap";
import nextConfig from "./next.config.mjs";
import { proxy } from "./proxy";
import {
  htmlCompatibilityRedirects,
  nativePublicRoutes,
  noindexRoutes,
  publicHtmlCompatibilityRedirects,
  retiredPublicRoutes,
  retiredRouteRedirects,
  robotsDisallowRoutes,
  sitemapEntries,
  staffRoutes
} from "./site-routes.mjs";

const webDir = import.meta.dirname;
const publicDir = join(webDir, "public");

describe("App Router route ownership", () => {
  it("centralizes saved .html URLs and retired pages as permanent Next redirects", async () => {
    const redirects = await nextConfig.redirects?.();

    expect(redirects).toEqual(
      [...publicHtmlCompatibilityRedirects, ...retiredRouteRedirects].map((redirect) => ({
        ...redirect,
        permanent: true
      }))
    );
    expect(new Set(htmlCompatibilityRedirects.map(({ source }) => source)).size).toBe(
      htmlCompatibilityRedirects.length
    );

    for (const { source } of htmlCompatibilityRedirects) {
      expect(source.endsWith(".html"), source).toBe(true);
      expect(existsSync(join(publicDir, source.slice(1))), source).toBe(false);
    }

    // Every retired page redirects home with both its clean and .html URLs,
    // and its App Router page no longer exists.
    expect(retiredPublicRoutes).toEqual(["about", "cafe", "experiences", "members"]);
    for (const route of retiredPublicRoutes) {
      expect(retiredRouteRedirects).toContainEqual({ source: `/${route}`, destination: "/" });
      expect(retiredRouteRedirects).toContainEqual({ source: `/${route}.html`, destination: "/" });
      expect(existsSync(join(webDir, `app/${route}/page.tsx`)), route).toBe(false);
    }
  });

  it("redirects staff compatibility URLs permanently with noindex", async () => {
    for (const [handler, source, destination] of [
      [proxy, "/admin.html", "/admin"],
      [proxy, "/pos.html", "/pos"]
    ] as const) {
      const response = await handler(new NextRequest(`https://skydeckla.com${source}?from=test`));

      expect(response).toBeInstanceOf(Response);
      if (!response) throw new Error(`Expected ${source} to redirect`);

      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe(`https://skydeckla.com${destination}?from=test`);
      expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    }
  });

  it("keeps public content in native pages without legacy browser data paths", () => {
    const checks: Array<[string, string[]]> = [
      ["app/checkout/page.tsx", ["CheckoutClient", "data-native-checkout"]],
      ["components/checkout-client.tsx", ["/api/order-drafts/checkout", "/api/payments/stripe-checkout"]],
      ["app/liability-waiver/page.tsx", ["Liability Waiver", "attorney-review draft"]],
      ["app/privacy/page.tsx", ["Convex"]],
      ["app/terms/page.tsx", ["Terms"]]
    ];

    for (const [path, expectedMarkers] of checks) {
      const contents = readFileSync(join(webDir, path), "utf8");
      for (const marker of expectedMarkers) {
        expect(contents, `${path} contains ${marker}`).toContain(marker);
      }
      expect(contents, `${path} legacy facade`).not.toContain("shared-data.js");
      expect(contents, `${path} legacy global`).not.toContain("SkylaData");
    }

    for (const retiredAsset of [
      "about.css",
      "admin.css",
      "admin.js",
      "cafe.css",
      "checkout.css",
      "checkout.js",
      "experiences.css",
      "members.css",
      "pos.css",
      "pos.js",
      "script.js",
      "shared-data.js",
      "styles.css"
    ]) {
      expect(existsSync(join(publicDir, retiredAsset)), retiredAsset).toBe(false);
    }
  });

  it("keeps internal migration status out of customer-facing copy", () => {
    const customerFacingFiles = [
      "app/page.tsx",
      "app/checkout/page.tsx",
      "app/liability-waiver/page.tsx",
      "components/checkout-client.tsx",
      "app/privacy/page.tsx"
    ];
    const internalPhrases = [
      /legacy browser/i,
      /browser-storage/i,
      /server API/i,
      /App Router/i,
      /Convex dashboard/i,
      /dashboards are wired/i,
      /secure database is connected/i,
      /server accepts the application/i,
      /server accepts the inquiry/i,
      /stored in Convex/i,
      /server-backed checkout/i
    ];

    for (const path of customerFacingFiles) {
      const contents = readFileSync(join(webDir, path), "utf8");
      for (const phrase of internalPhrases) {
        expect(contents, `${path} exposes ${phrase}`).not.toMatch(phrase);
      }
    }
  });

  it("generates robots and sitemap metadata from the shared route registry", () => {
    expect(new Set(nativePublicRoutes).size).toBe(nativePublicRoutes.length);
    expect(new Set(staffRoutes).size).toBe(staffRoutes.length);
    expect(robots()).toEqual({
      rules: {
        userAgent: "*",
        allow: "/",
        disallow: robotsDisallowRoutes
      },
      sitemap: "https://skydeckla.com/sitemap.xml"
    });
    expect(sitemap()).toEqual(
      sitemapEntries.map(({ path, priority }) => ({
        url: new URL(path, "https://skydeckla.com").toString(),
        priority,
        lastModified: expect.any(Date)
      }))
    );
    expect(existsSync(join(publicDir, "robots.txt"))).toBe(false);
    expect(existsSync(join(publicDir, "sitemap.xml"))).toBe(false);
  });

  it("keeps native and compatibility staff URLs out of public indexing", async () => {
    const headers = await nextConfig.headers?.();
    const noindexSources = new Set(
      headers
        ?.filter(({ headers }) => headers.some(({ key, value }) => key === "X-Robots-Tag" && value === "noindex, nofollow"))
        .map(({ source }) => source)
    );

    for (const source of noindexRoutes) {
      expect(noindexSources.has(source), source).toBe(true);
    }
    for (const route of nativePublicRoutes) {
      expect(noindexSources.has(`/${route}`), route).toBe(false);
    }
  });

  it("loads Google Ads config before the tracking helper on conversion pages", () => {
    const shared = readFileSync(join(webDir, "components/marketing-scripts.tsx"), "utf8");
    const configIndex = shared.indexOf('src="/ads-config.js"');
    const helperIndex = shared.indexOf('src="/ads-tracking.js');

    expect(configIndex, "shared config script").toBeGreaterThan(-1);
    expect(helperIndex, "shared tracking helper").toBeGreaterThan(-1);
    expect(configIndex, "shared script order").toBeLessThan(helperIndex);

    const homeContents = readFileSync(join(webDir, "app/page.tsx"), "utf8");
    expect(homeContents.includes("<MarketingScripts />"), "home marketing scripts").toBe(true);
  });

  it("keeps legacy Supabase payment functions permanently fail closed", () => {
    const terminal = readFileSync(join(webDir, "../../supabase/functions/stripe-terminal/index.ts"), "utf8");
    const checkout = readFileSync(join(webDir, "../../supabase/functions/stripe-checkout/index.ts"), "utf8");

    expect(terminal).toContain("Legacy Stripe Terminal bridge is permanently disabled");
    expect(terminal).toContain("410");
    expect(terminal).not.toContain("SKYLA_TERMINAL_SETUP_TOKEN");
    expect(terminal).not.toContain("/terminal/readers");
    expect(checkout).toContain("Legacy Stripe checkout function is permanently disabled");
    expect(checkout).toContain("status = 410");
    expect(checkout).not.toContain("STRIPE_SECRET_KEY");
    expect(checkout).not.toContain("checkout/sessions");
  });

  it("keeps native staff surfaces on server-owned routes", () => {
    const admin = readFileSync(join(webDir, "app/admin/page.tsx"), "utf8");
    const adminClient = readFileSync(join(webDir, "components/admin-ops-client.tsx"), "utf8");
    const pos = readFileSync(join(webDir, "components/pos-register-page.tsx"), "utf8");
    const payments = readFileSync(join(webDir, "../../convex/payments.ts"), "utf8");

    expect(admin).toContain("adminOpsPage");
    expect(adminClient).toContain("/api/admin/bookings/lookup");
    expect(adminClient).toContain("/api/admin/bookings/status");
    expect(pos).toContain("posNextPage");
    expect(pos).not.toContain('href="/pos.html"');
    expect(payments).toMatch(
      /export const createStripeTerminalPaymentIntent[\s\S]*?handler: async \(ctx, args\) => \{\n\s+assertPosTerminalAcceptanceEnabled\(\);/
    );
    expect(payments).toMatch(
      /export const processStripeTerminalPaymentIntent[\s\S]*?handler: async \(ctx, args\) => \{\n\s+assertPosTerminalAcceptanceEnabled\(\);/
    );
  });
});
