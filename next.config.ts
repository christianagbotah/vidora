import type { NextConfig } from "next";

// Production builds get the full security header set. Dev keeps iframe support
// for the local/Z.ai preview environment but still receives a useful CSP.
const isProduction = process.env.NODE_ENV === "production";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  `connect-src 'self' https: wss:${isProduction ? "" : " ws: http:"}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  ...(isProduction ? ["upgrade-insecure-requests"] : []),
]
  .filter(Boolean)
  .join("; ");

const securityHeaders = [
  // Prevent clickjacking. A dedicated embed surface can later opt into a
  // narrowly-scoped frame-ancestors policy; the main app stays fail-closed.
  ...(isProduction ? [{ key: "X-Frame-Options", value: "DENY" }] : []),
  ...(isProduction
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains; preload",
        },
      ]
    : []),
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Disable the obsolete browser XSS auditor; CSP is the modern control.
  { key: "X-XSS-Protection", value: "0" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=()",
  },
  { key: "Origin-Agent-Cluster", value: "?1" },
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
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "21.0.6.50",
    "*.space-z.ai",
    "space-z.ai",
  ],

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },

  // In production behind Caddy, CORS is handled by the reverse proxy.
  async rewrites() {
    return [];
  },
};

export default nextConfig;
