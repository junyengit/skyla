import type { MetadataRoute } from "next";

import { robotsDisallowRoutes } from "../site-routes.mjs";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: robotsDisallowRoutes
    },
    sitemap: "https://skydeckla.com/sitemap.xml"
  };
}
