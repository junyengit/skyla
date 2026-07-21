import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sky LA",
    short_name: "Sky LA",
    description:
      "Timed-entry observation deck on the top floor of 6100 Wilshire, with 360-degree views of Los Angeles.",
    start_url: "/",
    display: "browser",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/images/favicon-32.png", sizes: "32x32", type: "image/png" },
      { src: "/images/apple-touch-icon.png", sizes: "180x180", type: "image/png" }
    ]
  };
}
