import type { MetadataRoute } from "next";

import { sitemapEntries } from "../site-routes.mjs";

const siteOrigin = "https://skydeckla.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return sitemapEntries.map(({ path, priority }) => ({
    url: new URL(path, siteOrigin).toString(),
    priority,
    lastModified
  }));
}
