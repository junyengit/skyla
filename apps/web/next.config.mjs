import { noindexRoutes, publicHtmlCompatibilityRedirects, retiredRouteRedirects } from "./site-routes.mjs";

export const showcaseHomeOrigin = "https://skydeck-la.vercel.app";
export const showcaseHomeRewrites = [
  {
    source: "/",
    destination: `${showcaseHomeOrigin}/`
  }
];

/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  transpilePackages: ["@skyla/config", "@skyla/payments", "@skyla/ui"],
  async redirects() {
    return [...publicHtmlCompatibilityRedirects, ...retiredRouteRedirects].map((redirect) => ({
      ...redirect,
      permanent: true
    }));
  },
  async rewrites() {
    // The original standalone project is the authoritative public homepage.
    // Vercel serves it at the main domain without copying or reimplementing
    // the design; local development keeps this app self-contained.
    return process.env.VERCEL === "1"
      ? { beforeFiles: showcaseHomeRewrites, afterFiles: [], fallback: [] }
      : [];
  },
  async headers() {
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), payment=(self)"
      }
    ];

    return [
      {
        source: "/:path*",
        headers: securityHeaders
      },
      ...noindexRoutes.map((source) => ({
        source,
        headers: [
          ...securityHeaders,
          { key: "X-Robots-Tag", value: "noindex, nofollow" }
        ]
      }))
    ];
  }
};

export default nextConfig;
