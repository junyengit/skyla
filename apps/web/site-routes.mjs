export const nativePublicRoutes = ["checkout", "privacy", "terms"];

// Pages retired by the 2026-07 simple-site pivot. Saved links and old ads
// land on the single-product homepage instead of breaking.
export const retiredPublicRoutes = ["about", "cafe", "experiences", "members"];

export const staffRoutes = ["admin", "pos", "pos-next", "staff-sign-in"];

export const publicHtmlCompatibilityRedirects = [
  { source: "/index.html", destination: "/" },
  ...nativePublicRoutes.map((route) => ({ source: `/${route}.html`, destination: `/${route}` }))
];

export const retiredRouteRedirects = retiredPublicRoutes.flatMap((route) => [
  { source: `/${route}`, destination: "/" },
  { source: `/${route}.html`, destination: "/" }
]);

export const staffHtmlCompatibilityRedirects = [
  ...staffRoutes
    .filter((route) => route === "admin" || route === "pos")
    .map((route) => ({ source: `/${route}.html`, destination: `/${route}` }))
];

export const htmlCompatibilityRedirects = [
  ...publicHtmlCompatibilityRedirects,
  ...staffHtmlCompatibilityRedirects
];

export const noindexRoutes = [
  ...staffRoutes.flatMap((route) => [`/${route}`, `/${route}/:path*`])
];

export const robotsDisallowRoutes = ["/admin", "/admin.html", "/pos", "/pos.html", "/pos-next", "/staff-sign-in"];

export const sitemapEntries = [
  { path: "/", priority: 1 },
  { path: "/checkout", priority: 0.8 },
  { path: "/privacy", priority: 0.3 },
  { path: "/terms", priority: 0.3 }
];
