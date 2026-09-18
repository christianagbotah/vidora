import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";
import { livingPhotoGenerationProgress } from "../../src/lib/photo-studio-living-progress";

function read(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("Photo Studio Living Photos", () => {
  test("summarizes durable scene progress from persisted project state", () => {
    expect(livingPhotoGenerationProgress({
      status: "generating",
      scenes: [
        { status: "completed", videoUrl: "/generated/a.mp4" },
        { status: "generating", videoUrl: null },
      ],
    })).toMatchObject({
      status: "running",
      totalScenes: 2,
      completedScenes: 1,
      activeScenes: 1,
      progress: 50,
    });

    expect(livingPhotoGenerationProgress({
      status: "completed",
      scenes: [
        { status: "completed", videoUrl: "/generated/a.mp4" },
        { status: "completed", videoUrl: "/generated/b.mp4" },
      ],
    })).toMatchObject({
      status: "done",
      completedScenes: 2,
      progress: 100,
      error: null,
    });
  });

  test("surfaces failed Living Photo work without treating partial output as complete", () => {
    expect(livingPhotoGenerationProgress({
      status: "failed",
      scenes: [
        { status: "completed", videoUrl: "/generated/a.mp4" },
        { status: "failed", videoUrl: null, errorMessage: "Provider task failed safely" },
      ],
    })).toMatchObject({
      status: "failed",
      totalScenes: 2,
      completedScenes: 1,
      failedScenes: 1,
      progress: 50,
      error: "Provider task failed safely",
    });
  });

  test("project creation remains provider-free and paid motion starts only from the explicit Living Photo action", () => {
    const page = read("src/app/photo-studio/page.tsx");
    const createStart = page.indexOf("const createProject = async");
    const createEnd = page.indexOf("const openProjectInStudio", createStart);
    const livingStart = page.indexOf("const generateLivingPhotos = async");
    const livingEnd = page.indexOf("const renderSlideshowLocally", livingStart);

    expect(createStart).toBeGreaterThan(0);
    expect(createEnd).toBeGreaterThan(createStart);
    expect(page.slice(createStart, createEnd)).not.toContain("/api/generate-video");

    expect(livingStart).toBeGreaterThan(0);
    expect(livingEnd).toBeGreaterThan(livingStart);
    const living = page.slice(livingStart, livingEnd);
    expect(living).toContain('fetch("/api/generate-video"');
    expect(living).toContain('body: JSON.stringify({ projectId: result.projectId })');
    expect(living).toContain('body.code === "GENERATION_CANCELLED"');
    expect(living).toContain("livingPhotoGenerationProgress");
    expect(living).toContain("/api/projects/");
  });

  test("reuses the global Billing v2 confirmation gate instead of inventing Photo Studio pricing", () => {
    const page = read("src/app/photo-studio/page.tsx");
    const gate = read("src/components/GenerationBillingGate.tsx");
    const route = read("src/app/api/generate-video/route.ts");

    expect(page).toContain("Review cost & animate");
    expect(page).toContain("No credits are reserved until you explicitly confirm the generation.");
    expect(page).not.toContain("/cost-quote");

    expect(gate).toContain('url.pathname === "/api/generate-video"');
    expect(gate).toContain("/cost-quote");
    expect(gate).toContain("replayRequest(originalFetch, pending, quote.quoteId)");
    expect(route).toContain('code: "BILLING_QUOTE_REQUIRED"');
    expect(route).toContain("reserveBillingQuote");
  });
});
