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
    expect(existsSync(join(publicDir, "admin.html")), "admin.html staff handoff").toBe(true);

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
    for (const [route, fallback] of [
      ["/about", aboutFallback],
      ["/cafe", cafeFallback],
      ["/checkout", checkoutFallback],
      ["/experiences", experiencesFallback],
      ["/members", membersFallback],
      ["/privacy", privacyFallback],
      ["/terms", termsFallback]
    ]) {
      expect(fallback).toContain(`url=${route}`);
      expect(fallback).toContain(`href="${route}"`);
      expect(fallback).toContain("window.location.search");
      expect(fallback).toContain("window.location.hash");
      expect(fallback).toContain("window.location.replace");
      expect(fallback).not.toContain("shared-data.js");
      expect(fallback).not.toContain("SkylaData");
      expect(fallback).not.toContain("connect.facebook.net");
      expect(fallback).not.toContain('rel="stylesheet"');
    }
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
    expect(experiencesFallback).not.toContain("shared-data.js");
    expect(experiencesFallback).not.toContain("SkylaData.addInquiry");
    expect(membersFallback).not.toContain("shared-data.js");
    expect(membersFallback).not.toContain("SkylaData.addMember");
    expect(privacyFallback).not.toContain("shared-data.js");
    expect(termsFallback).not.toContain("shared-data.js");

    for (const retiredAsset of [
      "about.css",
      "cafe.css",
      "experiences.css",
      "members.css",
      "styles.css",
      "script.js"
    ]) {
      expect(existsSync(join(publicDir, retiredAsset)), retiredAsset).toBe(false);
    }
  });

  it("keeps admin and POS out of public indexing", () => {
    expect(noindexLegacyRoutes).toEqual(["admin", "pos"]);
    expect(noindexAppRoutes).toContain("admin");
    expect(noindexAppRoutes).toContain("pos");
    expect(noindexAppRoutes).toContain("pos-next");
    expect(noindexLegacyRoutes).not.toContain("members");
    expect(noindexAppRoutes).not.toContain("members");
    expect(legacyRoutes).not.toContain("pos");
    expect(existsSync(join(publicDir, "pos.html")), "pos.html staff handoff").toBe(true);

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

  it("keeps staff compatibility pages as native handoffs without legacy staff scripts", () => {
    const admin = readFileSync(join(publicDir, "admin.html"), "utf8");
    const pos = readFileSync(join(publicDir, "pos.html"), "utf8");
    const legacyTerminalFunction = readFileSync(join(import.meta.dirname, "../../supabase/functions/stripe-terminal/index.ts"), "utf8");

    expect(admin).toContain("url=/admin");
    expect(admin).toContain('href="/admin"');
    expect(admin).toContain("window.location.search");
    expect(admin).toContain("window.location.hash");
    expect(pos).toContain("url=/pos");
    expect(pos).toContain('href="/pos"');
    expect(pos).toContain("window.location.search");
    expect(pos).toContain("window.location.hash");
    for (const [label, html] of [
      ["admin", admin],
      ["pos", pos]
    ]) {
      for (const legacyMarker of [
        "shared-data.js",
        "admin.js",
        "pos.js",
        "admin.css",
        "pos.css",
        "SkylaData",
        "LEGACY_ADMIN_MUTATIONS_ENABLED",
        "LEGACY_TERMINAL_PAYMENTS_ENABLED",
        "clientSecret",
        "create-intent",
        "setup-reader",
        "js.stripe.com/terminal",
        "html5-qrcode"
      ]) {
        expect(html, `${label} handoff contains ${legacyMarker}`).not.toContain(legacyMarker);
      }
    }
    for (const retiredStaffAsset of ["admin.css", "admin.js", "pos.css", "pos.js", "shared-data.js"]) {
      expect(existsSync(join(publicDir, retiredStaffAsset)), retiredStaffAsset).toBe(false);
    }
    expect(legacyTerminalFunction).toContain('"setup-reader"');
    expect(legacyTerminalFunction).toContain("Legacy Stripe Terminal bridge is permanently disabled");
    expect(legacyTerminalFunction).not.toContain("SKYLA_TERMINAL_SETUP_TOKEN");
    expect(legacyTerminalFunction).not.toContain("/terminal/readers");
  });

  it("keeps the legacy Supabase Stripe checkout function fully retired", () => {
    const legacyCheckoutFunction = readFileSync(
      join(import.meta.dirname, "../../supabase/functions/stripe-checkout/index.ts"),
      "utf8"
    );

    expect(legacyCheckoutFunction).toContain("Legacy Stripe checkout function is permanently disabled");
    expect(legacyCheckoutFunction).toContain("status = 410");
    expect(legacyCheckoutFunction).not.toContain("STRIPE_SECRET_KEY");
    expect(legacyCheckoutFunction).not.toContain("STRIPE_API");
    expect(legacyCheckoutFunction).not.toContain("payload.action");
    expect(legacyCheckoutFunction).not.toContain("checkout/sessions");
    expect(legacyCheckoutFunction).not.toContain("withSupabase");
  });

  it("keeps native admin and POS staff surfaces high-contrast with server-owned staff routes", () => {
    const webDir = import.meta.dirname;
    const globalsCss = readFileSync(join(webDir, "app/globals.css"), "utf8");
    const nativeAdmin = readFileSync(join(webDir, "app/admin/page.tsx"), "utf8");
    const nativeAdminClient = readFileSync(join(webDir, "components/admin-ops-client.tsx"), "utf8");
    const nativeAdminLookupRoute = readFileSync(join(webDir, "app/api/admin/bookings/lookup/route.ts"), "utf8");
    const nativePrimaryPos = readFileSync(join(webDir, "app/pos/page.tsx"), "utf8");
    const nativePos = readFileSync(join(webDir, "app/pos-next/page.tsx"), "utf8");
    const nativePosPage = readFileSync(join(webDir, "components/pos-register-page.tsx"), "utf8");
    const adminHtml = readFileSync(join(publicDir, "admin.html"), "utf8");
    const posHtml = readFileSync(join(publicDir, "pos.html"), "utf8");
    const paymentsAction = readFileSync(join(import.meta.dirname, "../../convex/payments.ts"), "utf8");

    expect(nativeAdmin).toContain("adminOpsPage");
    expect(nativeAdmin).toContain("@skyla/payments");
    expect(nativeAdminClient).toContain('aria-label="Canonical catalog"');
    expect(nativeAdminClient).toContain("Booking Lookup");
    expect(nativeAdminClient).toContain("/api/admin/bookings/lookup");
    expect(nativeAdminClient).toContain("/api/admin/bookings/status");
    expect(nativeAdminLookupRoute).toContain("staffAuthRequiredResponse");
    expect(nativeAdminLookupRoute).toContain("convexUnconfiguredResponse");
    expect(nativeAdminLookupRoute).toContain("admin:lookupBookingForCheckIn");
    expect(nativePrimaryPos).toContain("PosRegisterPage");
    expect(nativePos).toContain("PosRegisterPage");
    expect(nativePosPage).toContain("posNextPage");
    expect(nativePosPage).toContain('data-pos-route={variant}');
    expect(nativePosPage).not.toContain('href="/pos.html"');
    expect(nativeAdmin).not.toContain('href="/admin.html"');
    expect(globalsCss).toContain(".adminOpsPage p,");
    expect(globalsCss).toContain(".posNextPage p,");
    expect(globalsCss).toContain("color: #fff");
    expect(globalsCss).toContain(".posNextActions .primaryAction:disabled");
    expect(globalsCss).toContain("opacity: 0.72");
    expect(adminHtml).toContain("The old admin file has been retired");
    expect(posHtml).toContain("The old POS file has been retired");
    expect(paymentsAction).toMatch(
      /export const createStripeTerminalPaymentIntent[\s\S]*?handler: async \(ctx, args\) => \{\n\s+assertPosTerminalAcceptanceEnabled\(\);/
    );
    expect(paymentsAction).toMatch(
      /export const processStripeTerminalPaymentIntent[\s\S]*?handler: async \(ctx, args\) => \{\n\s+assertPosTerminalAcceptanceEnabled\(\);/
    );
  });
});
