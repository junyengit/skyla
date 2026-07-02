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

  it("keeps legal pages native while preserving .html compatibility", () => {
    const webDir = import.meta.dirname;
    const privacyPage = readFileSync(join(webDir, "app/privacy/page.tsx"), "utf8");
    const termsPage = readFileSync(join(webDir, "app/terms/page.tsx"), "utf8");
    const legalComponent = readFileSync(join(webDir, "components/legal-page.tsx"), "utf8");

    expect(privacyPage).toContain("Convex");
    expect(privacyPage).not.toContain("stored using <strong>Supabase</strong>");
    expect(privacyPage).not.toContain("shared-data.js");
    expect(termsPage).not.toContain("shared-data.js");
    expect(legalComponent).not.toContain("shared-data.js");
  });

  it("keeps admin and POS out of public indexing", () => {
    expect(noindexLegacyRoutes).toEqual(["admin", "pos"]);
    expect(noindexAppRoutes).toContain("admin");
    expect(noindexAppRoutes).toContain("pos-next");

    const robots = readFileSync(join(publicDir, "robots.txt"), "utf8");
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
    for (const route of ["experiences", "members"]) {
      const html = readFileSync(join(publicDir, `${route}.html`), "utf8");
      const configIndex = html.indexOf('src="/ads-config.js"');
      const helperIndex = html.indexOf('src="ads-tracking.js');

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
