import {
  htmlCompatibilityRedirects,
  nativePublicRoutes,
  robotsDisallowRoutes,
  staffRoutes
} from "../../apps/web/site-routes.mjs";

const baseUrl = new URL(process.env.SMOKE_BASE_URL ?? "https://www.skydeckla.com");

const routes = Array.from(new Set([
  "/",
  ...nativePublicRoutes.map((route) => `/${route}`),
  ...staffRoutes.map((route) => `/${route}`),
  ...htmlCompatibilityRedirects.map(({ source }) => source),
  "/robots.txt",
  "/sitemap.xml"
]));

const noindexRoutes = Array.from(new Set([
  ...robotsDisallowRoutes
]));

const failures = [];

for (const route of routes) {
  const url = new URL(route, baseUrl);
  const response = await fetch(url, { redirect: "follow" });

  if (response.status !== 200) {
    failures.push(`${route}: expected 200, got ${response.status}`);
    continue;
  }

  if (noindexRoutes.includes(route)) {
    const robotsHeader = response.headers.get("x-robots-tag");
    if (robotsHeader !== "noindex, nofollow") {
      failures.push(`${route}: expected X-Robots-Tag noindex, nofollow; got ${robotsHeader ?? "none"}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`Smoke check failed for ${baseUrl.origin}:`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Smoke check passed for ${baseUrl.origin} (${routes.length} routes).`);
