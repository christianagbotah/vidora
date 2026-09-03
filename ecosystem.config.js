/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * ───────────────────────────────────────────────────────────────────────────
 *  Vidora — PM2 Ecosystem Configuration
 * ───────────────────────────────────────────────────────────────────────────
 *
 *  Loads all environment variables from the .env file (gitignored) and
 *  passes them to the Next.js standalone server.
 *
 *  USAGE:
 *    pm2 start ecosystem.config.js
 *    pm2 restart vidora --update-env     (after changing .env)
 *    pm2 logs vidora                     (tail logs)
 *    pm2 save                            (persist process list for reboot)
 *
 *  This file is safe to commit — it contains NO secrets. All secrets live
 *  in the .env file on the server.
 * ───────────────────────────────────────────────────────────────────────────
 */

// Load .env from the project root into process.env
require("dotenv").config({ path: __dirname + "/.env" });

module.exports = {
  apps: [
    {
      name: "vidora",
      script: ".next/standalone/server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "cluster",
      env: {
        NODE_ENV: "production",
        PORT: 3004,

        // CRITICAL: Override the system HOSTNAME (which is the machine's
        // hostname like "vps.example.com" and resolves to a single public IP).
        // The Next.js standalone server reads process.env.HOSTNAME to decide
        // which interface to bind. If it binds to the public IP only,
        // localhost connections (from nginx/Webuzo reverse proxy) are refused
        // → 502 Bad Gateway. "0.0.0.0" = listen on ALL interfaces.
        HOSTNAME: "0.0.0.0",

        // ── Database ──
        DATABASE_URL: process.env.DATABASE_URL,

        // ── NextAuth ──
        NEXTAUTH_URL: process.env.NEXTAUTH_URL,
        NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
        NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,

        // ── Z.ai SDK (CRITICAL — overrides .z-ai-config file lookup) ──
        ZAI_BASE_URL: process.env.ZAI_BASE_URL,
        ZAI_API_KEY: process.env.ZAI_API_KEY,
        ZAI_CHAT_MODEL: process.env.ZAI_CHAT_MODEL || "glm-4-plus",

        // ── Payment Gateways ──
        PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY,
        PAYSTACK_PUBLIC_KEY: process.env.PAYSTACK_PUBLIC_KEY,
        HUBTEL_CLIENT_ID: process.env.HUBTEL_CLIENT_ID,
        HUBTEL_CLIENT_SECRET: process.env.HUBTEL_CLIENT_SECRET,
        HUBTEL_MERCHANT_ACCOUNT: process.env.HUBTEL_MERCHANT_ACCOUNT,
        HUBTEL_MERCHANT_ID: process.env.HUBTEL_MERCHANT_ID,
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
        STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,

        // ── Legacy AI keys (kept for backward compat) ──
        IMAGE_API_KEY: process.env.IMAGE_API_KEY,
        VIDEO_API_KEY: process.env.VIDEO_API_KEY,
        TTS_API_KEY: process.env.TTS_API_KEY,

        // ── Email ──
        SMTP_HOST: process.env.SMTP_HOST,
        SMTP_PORT: process.env.SMTP_PORT,
        SMTP_USER: process.env.SMTP_USER,
        SMTP_PASSWORD: process.env.SMTP_PASSWORD,
      },
      // ── PM2 operational settings ──
      max_memory_restart: "1G",
      autorestart: true,
      watch: false,
      out_file: "./logs/pm2-out.log",
      error_file: "./logs/pm2-error.log",
      merge_logs: true,
      time: true,
    },
  ],
};
