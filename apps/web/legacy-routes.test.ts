import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { legacyRoutes, nativePublicRoutes, noindexAppRoutes, noindexLegacyRoutes } from "./legacy-routes.mjs";

const publicDir = join(import.meta.dirname, "public");

describe("legacy route bridge", () => {
  it("keeps a compatibility file for every legacy route", () => {
    expect(new Set(legacyRoutes).size).toBe(legacyRoutes.length);
    expect(new Set(nativePublicRoutes).size).toBe(nativePublicRoutes.length);

    for (const route of [...legacyRoutes, ...nativePublicRoutes]) {
      expect(existsSync(join(publicDir, `${route}.html`)), `${route}.html`).toBe(true);
    }
    expect(existsSync(join(publicDir, "admin.html")), "admin.html legacy fallback").toBe(true);

    for (const route of [...nativePublicRoutes, "admin"]) {
      expect(legacyRoutes).not.toContain(route);
    }
  });

  it("keeps static public pages native while preserving .html compatibility", () => {
    const webDir = import.meta.dirname;
    const aboutPage = readFileSync(join(webDir, "app/about/page.tsx"), "utf8");
    const cafePage = readFileSync(join(webDir, "app/cafe/page.tsx"), "utf8");
    const membersPage = readFileSync(join(webDir, "app/members/page.tsx"), "utf8");
    const membersClient = readFileSync(join(webDir, "components/members-application-client.tsx"), "utf8");
    const experiencesPage = readFileSync(join(webDir, "app/experiences/page.tsx"), "utf8");
    const experiencesClient = readFileSync(join(webDir, "components/experience-inquiry-client.tsx"), "utf8");
    const checkoutPage = readFileSync(join(webDir, "app/checkout/page.tsx"), "utf8");
    const checkoutClient = readFileSync(join(webDir, "components/checkout-client.tsx"), "utf8");
    const privacyPage = readFileSync(join(webDir, "app/privacy/page.tsx"), "utf8");
    const termsPage = readFileSync(join(webDir, "app/terms/page.tsx"), "utf8");
    const publicComponent = readFileSync(join(webDir, "components/public-page-shell.tsx"), "utf8");
    const legalComponent = readFileSync(join(webDir, "components/legal-page.tsx"), "utf8");
    const aboutFallback = readFileSync(join(publicDir, "about.html"), "utf8");
    const cafeFallback = readFileSync(join(publicDir, "cafe.html"), "utf8");
    const checkoutFallback = readFileSync(join(publicDir, "checkout.html"), "utf8");
    const experiencesFallback = readFileSync(join(publicDir, "experiences.html"), "utf8");
    const membersFallback = readFileSync(join(publicDir, "members.html"), "utf8");
    const privacyFallback = readFileSync(join(publicDir, "privacy.html"), "utf8");
    const termsFallback = readFileSync(join(publicDir, "terms.html"), "utf8");

    expect(aboutPage).toContain("Best Space");
    expect(cafePage).toContain("cafeItems");
    expect(cafePage).toContain("@skyla/payments");
    expect(membersPage).toContain("MembersApplicationClient");
    expect(membersClient).toContain("/api/members/applications");
    expect(membersClient).toContain("idempotencyKey");
    expect(experiencesPage).toContain("ExperienceInquiryClient");
    expect(experiencesClient).toContain("/api/experiences/inquiries");
    expect(experiencesClient).toContain("idempotencyKey");
    expect(checkoutPage).toContain("CheckoutClient");
    expect(checkoutClient).toContain("/api/order-drafts/checkout");
    expect(checkoutClient).toContain("/api/payments/stripe-checkout");
    expect(privacyPage).toContain("Convex");
    expect(privacyFallback).toContain("Convex");
    expect(privacyPage).not.toContain("stored using <strong>Supabase</strong>");
    expect(privacyFallback).not.toContain("stored using <strong>Supabase</strong>");
    expect(aboutPage).not.toContain("shared-data.js");
    expect(cafePage).not.toContain("shared-data.js");
    expect(checkoutPage).not.toContain("shared-data.js");
    expect(checkoutClient).not.toContain("SkylaData.addBooking");
    expect(membersPage).not.toContain("shared-data.js");
    expect(membersClient).not.toContain("SkylaData.addMember");
    expect(experiencesPage).not.toContain("shared-data.js");
    expect(experiencesClient).not.toContain("SkylaData.addInquiry");
    expect(privacyPage).not.toContain("shared-data.js");
    expect(termsPage).not.toContain("shared-data.js");
    expect(publicComponent).not.toContain("shared-data.js");
    expect(legalComponent).not.toContain("shared-data.js");
    expect(aboutFallback).not.toContain("shared-data.js");
    expect(cafeFallback).not.toContain("shared-data.js");
    expect(checkoutFallback).toContain("url=/checkout");
    expect(checkoutFallback).not.toContain("shared-data.js");
    expect(checkoutFallback).not.toContain("checkout.js");
    expect(checkoutFallback).not.toContain("checkout.css");
    expect(checkoutFallback).not.toContain("SkylaData");
    expect(checkoutFallback).not.toContain("SkylaData.addBooking");
    expect(checkoutFallback).not.toContain("KASKADE_ENABLED");
    expect(checkoutFallback).not.toContain("stripe-checkout");
    expect(checkoutFallback).not.toContain("kaskade-payment");
    expect(existsSync(join(publicDir, "checkout.js"))).toBe(false);
    expect(existsSync(join(publicDir, "checkout.css"))).toBe(false);
    expect(experiencesFallback).toContain("url=/experiences");
    expect(experiencesFallback).not.toContain("shared-data.js");
    expect(experiencesFallback).not.toContain("SkylaData.addInquiry");
    expect(membersFallback).toContain("url=/members");
    expect(membersFallback).not.toContain("shared-data.js");
    expect(membersFallback).not.toContain("SkylaData.addMember");
    expect(privacyFallback).not.toContain("shared-data.js");
    expect(termsFallback).not.toContain("shared-data.js");
  });

  it("keeps admin and POS out of public indexing", () => {
    expect(noindexLegacyRoutes).toEqual(["admin", "pos"]);
    expect(noindexAppRoutes).toContain("admin");
    expect(noindexAppRoutes).toContain("pos-next");
    expect(noindexLegacyRoutes).not.toContain("members");
    expect(noindexAppRoutes).not.toContain("members");

    const robots = readFileSync(join(publicDir, "robots.txt"), "utf8");
    expect(robots).not.toContain("Disallow: /members");
    for (const route of noindexLegacyRoutes) {
      expect(robots).toContain(`Disallow: /${route}`);
      expect(robots).toContain(`Disallow: /${route}.html`);
    }
  });

  it("keeps sitemap focused on public routes", () => {
    const sitemap = readFileSync(join(publicDir, "sitemap.xml"), "utf8");
    const publicLegacyRoutes = legacyRoutes.filter((route) => !noindexLegacyRoutes.includes(route));

    for (const route of [...publicLegacyRoutes, ...nativePublicRoutes]) {
      expect(sitemap).toContain(`https://skydeckla.com/${route}`);
    }

    for (const route of noindexLegacyRoutes) {
      expect(sitemap).not.toContain(`https://skydeckla.com/${route}`);
    }
  });

  it("loads Google Ads config before the tracking helper on conversion pages", () => {
    const experiences = readFileSync(join(import.meta.dirname, "app/experiences/page.tsx"), "utf8");
    const membersPage = readFileSync(join(import.meta.dirname, "app/members/page.tsx"), "utf8");

    for (const [route, contents] of [
      ["experiences", experiences],
      ["members", membersPage]
    ]) {
      const configIndex = contents.indexOf('src="/ads-config.js"');
      const helperIndex = Math.max(
        contents.indexOf('src="/ads-tracking.js'),
        contents.indexOf('src="ads-tracking.js')
      );

      expect(configIndex, `${route} config script`).toBeGreaterThan(-1);
      expect(helperIndex, `${route} tracking helper`).toBeGreaterThan(-1);
      expect(configIndex, `${route} script order`).toBeLessThan(helperIndex);
    }
  });

  it("keeps Stripe reader setup gated by a manager setup token field", () => {
    const pos = readFileSync(join(publicDir, "pos.html"), "utf8");

    expect(pos).toContain('id="reader-token"');
    expect(pos).toContain('type="password"');
  });

  it("keeps admin and POS staff surfaces high-contrast while legacy charging stays disabled", () => {
    const webDir = import.meta.dirname;
    const globalsCss = readFileSync(join(webDir, "app/globals.css"), "utf8");
    const nativeAdmin = readFileSync(join(webDir, "app/admin/page.tsx"), "utf8");
    const nativeAdminClient = readFileSync(join(webDir, "components/admin-ops-client.tsx"), "utf8");
    const nativePos = readFileSync(join(webDir, "app/pos-next/page.tsx"), "utf8");
    const adminHtml = readFileSync(join(publicDir, "admin.html"), "utf8");
    const adminCss = readFileSync(join(publicDir, "admin.css"), "utf8");
    const posHtml = readFileSync(join(publicDir, "pos.html"), "utf8");
    const posCss = readFileSync(join(publicDir, "pos.css"), "utf8");
    const posJs = readFileSync(join(publicDir, "pos.js"), "utf8");

    expect(nativeAdmin).toContain("adminOpsPage");
    expect(nativeAdmin).toContain("@skyla/payments");
    expect(nativeAdminClient).toContain('aria-label="Canonical catalog"');
    expect(nativePos).toContain("posNextPage");
    expect(globalsCss).toContain(".adminOpsPage p,");
    expect(globalsCss).toContain(".posNextPage p,");
    expect(globalsCss).toContain("color: #fff");
    expect(adminHtml).toContain("admin.css?v=8");
    expect(adminCss).toContain("--gray:      #ffffff");
    expect(adminCss).toContain(".hours-input:disabled");
    expect(adminCss).toContain("opacity: 0.75");
    expect(posHtml).toContain("pos.css?v=10");
    expect(posCss).toContain("--muted: #ffffff");
    expect(posCss).toContain(".pos-cart__charge:disabled { opacity: 0.72");
    expect(posJs).toContain("function escHtml");
    expect(posJs).toContain("escHtml(l.name)");
    expect(posJs).toContain("escHtml(i.name)");
    expect(posJs).toContain("LEGACY_TERMINAL_PAYMENTS_ENABLED = false");
    expect(posJs).toContain("Card-present payments are moving to the secure /pos-next flow");
  });
});
