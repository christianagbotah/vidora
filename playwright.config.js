const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["line"]] : [["list"]],
  use: {
    baseURL: process.env.VIDORA_E2E_BASE_URL || "http://127.0.0.1:3000",
    browserName: "chromium",
    channel: "chrome",
    headless: true,
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
