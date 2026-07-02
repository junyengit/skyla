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
    const privacyPage = readFileSync(join(webDir, "app/privacy/page.tsx"), "utf8");
    const termsPage = readFileSync(join(webDir, "app/terms/page.tsx"), "utf8");
    const publicComponent = readFileSync(join(webDir, "components/public-page-shell.tsx"), "utf8");
    const legalComponent = readFileSync(join(webDir, "components/legal-page.tsx"), "utf8");
    const aboutFallback = readFileSync(join(publicDir, "about.html"), "utf8");
    const cafeFallback = readFileSync(join(publicDir, "cafe.html"), "utf8");
    const membersFallback = readFileSync(join(publicDir, "members.html"), "utf8");
    const privacyFallback = readFileSync(join(publicDir, "privacy.html"), "utf8");
    const termsFallback = readFileSync(join(publicDir, "terms.html"), "utf8");

    expect(aboutPage).toContain("Best Space");
    expect(cafePage).toContain("cafeItems");
    expect(cafePage).toContain("@skyla/payments");
    expect(membersPage).toContain("MembersApplicationClient");
    expect(membersClient).toContain("/api/members/applications");
    expect(membersClient).toContain("idempotencyKey");
    expect(privacyPage).toContain("Convex");
    expect(privacyFallback).toContain("Convex");
    expect(privacyPage).not.toContain("stored using <strong>Supabase</strong>");
    expect(privacyFallback).not.toContain("stored using <strong>Supabase</strong>");
    expect(aboutPage).not.toContain("shared-data.js");
    expect(cafePage).not.toContain("shared-data.js");
    expect(membersPage).not.toContain("shared-data.js");
    expect(membersClient).not.toContain("SkylaData.addMember");
    expect(privacyPage).not.toContain("shared-data.js");
    expect(termsPage).not.toContain("shared-data.js");
    expect(publicComponent).not.toContain("shared-data.js");
    expect(legalComponent).not.toContain("shared-data.js");
    expect(aboutFallback).not.toContain("shared-data.js");
    expect(cafeFallback).not.toContain("shared-data.js");
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
    const experiences = readFileSync(join(publicDir, "experiences.html"), "utf8");
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
});
