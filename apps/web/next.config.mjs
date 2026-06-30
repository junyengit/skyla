/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@skyla/config", "@skyla/ui"],
  images: {
    remotePatterns: [
      new URL("https://api.qrserver.com/**")
    ]
  },
  async rewrites() {
    const legacyRoutes = [
      "about",
      "cafe",
      "checkout",
      "experiences",
      "members",
      "privacy",
      "terms",
      "admin",
      "pos"
    ];

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
      {
        source: "/admin",
        headers: [
          ...securityHeaders,
          { key: "X-Robots-Tag", value: "noindex, nofollow" }
        ]
      },
      {
        source: "/admin.html",
        headers: [
          ...securityHeaders,
          { key: "X-Robots-Tag", value: "noindex, nofollow" }
        ]
      },
      {
        source: "/admin/:path*",
        headers: [
          ...securityHeaders,
          { key: "X-Robots-Tag", value: "noindex, nofollow" }
        ]
      },
      {
        source: "/pos",
        headers: [
          ...securityHeaders,
          { key: "X-Robots-Tag", value: "noindex, nofollow" }
        ]
      },
      {
        source: "/pos.html",
        headers: [
          ...securityHeaders,
          { key: "X-Robots-Tag", value: "noindex, nofollow" }
        ]
      },
      {
        source: "/pos/:path*",
        headers: [
          ...securityHeaders,
          { key: "X-Robots-Tag", value: "noindex, nofollow" }
        ]
      }
    ];
  }
};

export default nextConfig;
