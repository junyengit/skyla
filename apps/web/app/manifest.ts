import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sky LA",
    short_name: "Sky LA",
    description:
      "360-degree rooftop views, cafe, private experiences, and ticketed visits above 6100 Wilshire in Los Angeles.",
    start_url: "/",
    display: "browser",
    background_color: "#090909",
    theme_color: "#090909",
    icons: [
      { src: "/images/favicon-32.png", sizes: "32x32", type: "image/png" },
      { src: "/images/apple-touch-icon.png", sizes: "180x180", type: "image/png" }
    ]
  };
}
