import type { NextConfig } from "next";

const securityHeaders = [
  // Prevent MIME type sniffing
  { key: "X-Content-Type-Options", value: "nosniff" },
  // XSS protection (legacy, but still helps older browsers)
  { key: "X-XSS-Protection", value: "1; mode=block" },
  // Referrer policy — send origin only
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Permissions policy — restrict browser features
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
  // NOTE (sandbox): X-Frame-Options DENY and HSTS are intentionally omitted
  // in this dev sandbox so the preview panel can embed the app in an iframe.
  // Restore them for production deployments.
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
  allowedDevOrigins: ["localhost", "127.0.0.1", "21.0.6.50", "*.space-z.ai", "space-z.ai"],

  // ── Security Headers ──
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },

  // ── CORS ──
  // In production behind Caddy, CORS is handled by the reverse proxy.
  async rewrites() {
    return [];
  },
};

export default nextConfig;
