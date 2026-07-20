import { noindexRoutes, publicHtmlCompatibilityRedirects, retiredRouteRedirects } from "./site-routes.mjs";

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
