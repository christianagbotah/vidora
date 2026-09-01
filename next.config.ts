import type { NextConfig } from "next";

const securityHeaders = [
  // Prevent clickjacking
  { key: "X-Frame-Options", value: "DENY" },
  // Prevent MIME type sniffing
  { key: "X-Content-Type-Options", value: "nosniff" },
  // XSS protection (legacy, but still helps older browsers)
  { key: "X-XSS-Protection", value: "1; mode=block" },
  // Referrer policy — send origin only
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Permissions policy — restrict browser features
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
  // HSTS — enforce HTTPS (1 year, include subdomains)
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["bcryptjs"],
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: ["21.0.6.50", "*.space-z.ai", "space-z.ai"],

  // ── Security Headers ──
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      // Allow iframe embedding for shared project pages only
      {
        source: "/api/share/:path*",
        headers: [
          { key: "X-Frame-Options", value: "ALLOW-FROM https://vidora.lightworldtech.com" },
        ],
      },
    ];
  },

  // ── CORS ──
  // In production behind Caddy, CORS is handled by the reverse proxy.
  // These settings allow the same origin + the configured site URL.
  async rewrites() {
    return [];
  },
};

export default nextConfig;
