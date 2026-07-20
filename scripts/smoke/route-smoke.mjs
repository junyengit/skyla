import {
  htmlCompatibilityRedirects,
  nativePublicRoutes,
  retiredRouteRedirects,
  robotsDisallowRoutes,
  sitemapEntries,
  staffRoutes
} from "../../apps/web/site-routes.mjs";

const baseUrl = new URL(process.env.SMOKE_BASE_URL ?? "https://www.skydeckla.com");

const routes = Array.from(new Set([
  "/",
  ...nativePublicRoutes.map((route) => `/${route}`),
  ...staffRoutes.map((route) => `/${route}`),
  ...htmlCompatibilityRedirects.map(({ source }) => source),
  ...retiredRouteRedirects.map(({ source }) => source),
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

await checkMetadataRoutes();

if (failures.length > 0) {
  console.error(`Smoke check failed for ${baseUrl.origin}:`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Smoke check passed for ${baseUrl.origin} (${routes.length} routes).`);

async function checkMetadataRoutes() {
  const robotsResponse = await fetch(new URL("/robots.txt", baseUrl));
  const robots = await robotsResponse.text();
  if (!robotsResponse.headers.get("content-type")?.includes("text/plain")) {
    failures.push(`/robots.txt: expected text/plain content type`);
  }
  for (const route of robotsDisallowRoutes) {
    if (!robots.includes(`Disallow: ${route}`)) {
      failures.push(`/robots.txt: missing Disallow: ${route}`);
    }
  }

  const sitemapResponse = await fetch(new URL("/sitemap.xml", baseUrl));
  const sitemap = await sitemapResponse.text();
  if (!sitemapResponse.headers.get("content-type")?.includes("application/xml")) {
    failures.push(`/sitemap.xml: expected application/xml content type`);
  }
  for (const { path } of sitemapEntries) {
    const canonical = new URL(path, "https://skydeckla.com").toString();
    if (!sitemap.includes(`<loc>${canonical}</loc>`)) {
      failures.push(`/sitemap.xml: missing ${canonical}`);
    }
  }
  for (const route of staffRoutes) {
    if (sitemap.includes(`skydeckla.com/${route}`)) {
      failures.push(`/sitemap.xml: staff route /${route} must not be indexed`);
    }
  }
}
