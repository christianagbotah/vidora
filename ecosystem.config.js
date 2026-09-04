/* eslint-disable @typescript-eslint/no-require-imports */
require("dotenv").config({ path: __dirname + "/.env" });

module.exports = {
  apps: [
    {
      name: "vidora",
      script: ".next/standalone/server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3004,
        HOSTNAME: "0.0.0.0",

        DATABASE_URL: process.env.DATABASE_URL,
        NEXTAUTH_URL: process.env.NEXTAUTH_URL,
        NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
        NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
        CONFIG_ENCRYPTION_KEY: process.env.CONFIG_ENCRYPTION_KEY,
        GENERATED_DIR: process.env.GENERATED_DIR,

        ZAI_BASE_URL: process.env.ZAI_BASE_URL,
        ZAI_API_KEY: process.env.ZAI_API_KEY,
        ZAI_CHAT_MODEL: process.env.ZAI_CHAT_MODEL || "glm-4-plus",

        PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY,
        PAYSTACK_PUBLIC_KEY: process.env.PAYSTACK_PUBLIC_KEY,
        HUBTEL_CLIENT_ID: process.env.HUBTEL_CLIENT_ID,
        HUBTEL_CLIENT_SECRET: process.env.HUBTEL_CLIENT_SECRET,
        HUBTEL_MERCHANT_ACCOUNT_NUMBER: process.env.HUBTEL_MERCHANT_ACCOUNT_NUMBER,
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
        STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,

        SMTP_HOST: process.env.SMTP_HOST,
        SMTP_PORT: process.env.SMTP_PORT,
        SMTP_USER: process.env.SMTP_USER,
        SMTP_PASSWORD: process.env.SMTP_PASSWORD,
        SMTP_FROM: process.env.SMTP_FROM,

        IMAGE_API_KEY: process.env.IMAGE_API_KEY,
        VIDEO_API_KEY: process.env.VIDEO_API_KEY,
        TTS_API_KEY: process.env.TTS_API_KEY,
      },
      max_memory_restart: "1G",
      autorestart: true,
      restart_delay: 3000,
      min_uptime: "10s",
      max_restarts: 10,
      kill_timeout: 15000,
      listen_timeout: 15000,
      watch: false,
      out_file: "./logs/pm2-out.log",
      error_file: "./logs/pm2-error.log",
      merge_logs: true,
      time: true,
    },
  ],
};
