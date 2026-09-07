// CommonJS is intentional here: CI installs Playwright under /tmp and exposes it
// through NODE_PATH so browser tooling cannot mutate Vidora's Bun dependency tree.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { test, expect } = require("@playwright/test");

const E2E_EMAIL = process.env.VIDORA_E2E_EMAIL || "e2e@vidora.local";
const E2E_PASSWORD = process.env.VIDORA_E2E_PASSWORD || "VidoraE2E!2026";
const E2E_PROJECT_TITLE = process.env.VIDORA_E2E_PROJECT_TITLE || "Vidora E2E Golden Project";

const GENERATIVE_PATHS = [
  "/api/generate-video",
  "/api/generate-video-scene",
  "/api/generate-narration",
  "/api/generate-character-portrait",
  "/api/generate-image",
  "/api/enhance-prompt",
  "/api/parse-script",
  "/api/ai/continuity",
];

function isGenerativeRequest(url) {
  const pathname = new URL(url).pathname;
  const matchesKnownPath = GENERATIVE_PATHS.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (matchesKnownPath) return true;
  return /^\/api\/scenes\/[^/]+\/dubbing$/.test(pathname);
}

async function waitForVidoraOverlays(page) {
  await expect.poll(
    async () => page.locator(".preloader-root").count(),
    {
      timeout: 20_000,
      message: "Vidora preloader/view-transition overlay should release pointer input",
    },
  ).toBe(0);
}

test.describe("Vidora zero-cost browser golden path", () => {
  test("login, open completed project, persist Voice Studio defaults, and remain responsive", async ({ page }) => {
    const blockedGenerativeRequests = [];
    await page.route("**/api/**", async (route) => {
      if (isGenerativeRequest(route.request().url())) {
        blockedGenerativeRequests.push(route.request().url());
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });

    await page.goto("/?auth=login");
    await expect(page.getByRole("heading", { name: "Welcome Back" })).toBeVisible();

    await page.getByPlaceholder("you@example.com").fill(E2E_EMAIL);
    await page.getByPlaceholder("••••••••").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign In", exact: true }).click();

    const statsButton = page.getByRole("button", { name: "Stats", exact: true });
    await expect(statsButton).toBeVisible({ timeout: 20_000 });
    await waitForVidoraOverlays(page);
    await statsButton.click();
    await waitForVidoraOverlays(page);

    const projectTitle = page.getByText(E2E_PROJECT_TITLE, { exact: true }).first();
    await expect(projectTitle).toBeVisible();
    await projectTitle.click();
    await waitForVidoraOverlays(page);

    const voiceStudioLauncher = page.getByRole("link", {
      name: "Open Voice Studio for the current project",
    });
    await expect(voiceStudioLauncher).toBeVisible();
    await voiceStudioLauncher.click();

    await expect(page.getByRole("heading", { name: E2E_PROJECT_TITLE })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Entire video" })).toBeVisible();

    const accent = page.getByRole("combobox", { name: "Narration accent" }).first();
    await accent.click();
    await page.getByRole("option", { name: "Ghanaian English" }).click();

    const style = page.getByRole("combobox", { name: "Narration speaking style" }).first();
    await style.click();
    await page.getByRole("option", { name: "Documentary" }).click();

    await page.getByRole("button", { name: "Save whole-video default" }).click();
    await expect(page.getByText(/updated 1 current scene/i)).toBeVisible();
    await expect(page.getByText("Saved project default", { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: E2E_PROJECT_TITLE })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Narration accent" }).first()).toContainText("Ghanaian English");
    await expect(page.getByRole("combobox", { name: "Narration speaking style" }).first()).toContainText("Documentary");
    await expect(page.getByText("Uses project default", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Back to Vidora Studio" }).click();
    await expect(voiceStudioLauncher).toBeVisible();
    await waitForVidoraOverlays(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(voiceStudioLauncher).toBeVisible();
    const desktopOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(desktopOverflow).toBeLessThanOrEqual(2);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(voiceStudioLauncher).toBeVisible();
    const mobileOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(mobileOverflow).toBeLessThanOrEqual(2);

    expect(
      blockedGenerativeRequests,
      `Unexpected generative requests were attempted: ${blockedGenerativeRequests.join(", ")}`,
    ).toEqual([]);
  });
});
