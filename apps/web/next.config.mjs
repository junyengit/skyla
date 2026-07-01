import { legacyRoutes, noindexAppRoutes, noindexLegacyRoutes } from "./legacy-routes.mjs";

/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  transpilePackages: ["@skyla/config", "@skyla/payments", "@skyla/ui"],
  images: {
    remotePatterns: [
      new URL("https://api.qrserver.com/**")
    ]
  },
  async rewrites() {
    return [
      {
        source: "/index.html",
        destination: "/"
      },
      ...legacyRoutes.map((route) => ({
        source: `/${route}`,
        destination: `/${route}.html`
      }))
    ];
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
      ...noindexLegacyRoutes.flatMap((route) => [
        {
          source: `/${route}`,
          headers: [
            ...securityHeaders,
            { key: "X-Robots-Tag", value: "noindex, nofollow" }
          ]
        },
        {
          source: `/${route}.html`,
          headers: [
            ...securityHeaders,
            { key: "X-Robots-Tag", value: "noindex, nofollow" }
          ]
        },
        {
          source: `/${route}/:path*`,
          headers: [
            ...securityHeaders,
            { key: "X-Robots-Tag", value: "noindex, nofollow" }
          ]
        }
      ]),
      ...noindexAppRoutes.flatMap((route) => [
        {
          source: `/${route}`,
          headers: [
            ...securityHeaders,
            { key: "X-Robots-Tag", value: "noindex, nofollow" }
          ]
        },
        {
          source: `/${route}/:path*`,
          headers: [
            ...securityHeaders,
            { key: "X-Robots-Tag", value: "noindex, nofollow" }
          ]
        }
      ])
    ];
  }
};

export default nextConfig;
