export const nativePublicRoutes = ["about", "cafe", "checkout", "experiences", "members", "privacy", "terms"];

export const staffRoutes = ["admin", "pos", "pos-next"];

export const htmlCompatibilityRedirects = [
  { source: "/index.html", destination: "/" },
  ...nativePublicRoutes.map((route) => ({ source: `/${route}.html`, destination: `/${route}` })),
  ...staffRoutes
    .filter((route) => route !== "pos-next")
    .map((route) => ({ source: `/${route}.html`, destination: `/${route}` }))
];

export const noindexRoutes = [
  ...staffRoutes.flatMap((route) => [`/${route}`, `/${route}/:path*`]),
  "/admin.html",
  "/pos.html"
];

export const robotsDisallowRoutes = ["/admin", "/admin.html", "/pos", "/pos.html", "/pos-next"];

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
