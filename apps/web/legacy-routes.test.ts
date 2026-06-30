import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { legacyRoutes, noindexLegacyRoutes } from "./legacy-routes.mjs";

const publicDir = join(import.meta.dirname, "public");

describe("legacy route bridge", () => {
  it("keeps a compatibility file for every legacy route", () => {
    expect(new Set(legacyRoutes).size).toBe(legacyRoutes.length);
    expect(legacyRoutes).not.toContain("checkout");

    for (const route of legacyRoutes) {
      expect(existsSync(join(publicDir, `${route}.html`)), `${route}.html`).toBe(true);
    }
    expect(existsSync(join(publicDir, "checkout.html")), "checkout.html legacy fallback").toBe(true);
  });

  it("keeps admin and POS out of public indexing", () => {
    expect(noindexLegacyRoutes).toEqual(["admin", "pos"]);

    const robots = readFileSync(join(publicDir, "robots.txt"), "utf8");
    for (const route of noindexLegacyRoutes) {
      expect(robots).toContain(`Disallow: /${route}`);
      expect(robots).toContain(`Disallow: /${route}.html`);
    }
  });

  it("keeps sitemap focused on public routes", () => {
    const sitemap = readFileSync(join(publicDir, "sitemap.xml"), "utf8");
    const publicLegacyRoutes = legacyRoutes.filter((route) => !noindexLegacyRoutes.includes(route));

    for (const route of publicLegacyRoutes) {
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
