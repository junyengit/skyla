export const nativePublicRoutes = ["about", "cafe", "checkout", "experiences", "members", "privacy", "terms"];

export const staffRoutes = ["admin", "pos", "pos-next", "staff-sign-in"];

export const publicHtmlCompatibilityRedirects = [
  { source: "/index.html", destination: "/" },
  ...nativePublicRoutes.map((route) => ({ source: `/${route}.html`, destination: `/${route}` }))
];

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
  { path: "/about", priority: 0.8 },
  { path: "/experiences", priority: 0.8 },
  { path: "/cafe", priority: 0.7 },
  { path: "/members", priority: 0.7 },
  { path: "/checkout", priority: 0.6 },
  { path: "/privacy", priority: 0.3 },
  { path: "/terms", priority: 0.3 }
];
