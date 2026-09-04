import type { NextConfig } from "next";

// Production builds get the full security header set (X-Frame-Options DENY + HSTS).
// Dev builds omit them so the sandbox preview panel can embed the app in an iframe.
const isProduction = process.env.NODE_ENV === "production";

const securityHeaders = [
  // Prevent clickjacking (production only — dev preview requires iframes)
  ...(isProduction ? [{ key: "X-Frame-Options", value: "DENY" }] : []),
  // HSTS — enforce HTTPS (production only)
  ...(isProduction
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains; preload",
        },
      ]
    : []),
  // Prevent MIME type sniffing
  { key: "X-Content-Type-Options", value: "nosniff" },
  // XSS protection (legacy, but still helps older browsers)
  { key: "X-XSS-Protection", value: "1; mode=block" },
  // Referrer policy — send origin only
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Permissions policy — restrict browser features
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["bcryptjs"],
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
  // Production builds must fail closed when TypeScript compilation fails.
  // Do not re-enable `typescript.ignoreBuildErrors`.
  reactStrictMode: false,
  allowedDevOrigins: ["localhost", "127.0.0.1", "21.0.6.50", "*.space-z.ai", "space-z.ai"],

  // ── Security Headers ──
  async headers() {
    const rules = [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
    // Allow iframe embedding for shared project pages only (production)
    if (isProduction) {
      rules.push({
        source: "/api/share/:path*",
        headers: [
          { key: "X-Frame-Options", value: "ALLOW-FROM https://vidora.lightworldtech.com" },
        ],
      });
    }
    return rules;
  },

  // ── CORS ──
  // In production behind Caddy, CORS is handled by the reverse proxy.
  async rewrites() {
    return [];
  },
};

export default nextConfig;
