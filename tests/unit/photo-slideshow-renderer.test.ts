import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";
import {
  photoSlideshowSourceSignature,
  slideshowCanvas,
  slideshowMotionForIndex,
  slideshowVideoFilter,
} from "../../src/lib/photo-slideshow-plan";

function read(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

const scenes = [
  {
    id: "scene-1",
    sceneNumber: 1,
    referenceImageUrl: "/generated/users/u1/photo-studio/a.jpg",
    imageUrl: "/generated/users/u1/photo-studio/a.jpg",
    duration: 6,
    transition: "fade",
  },
];

describe("provider-free Photo Studio slideshow renderer", () => {
  test("source signatures are deterministic and invalidate when render inputs change", () => {
    const base = photoSlideshowSourceSignature({ projectId: "p1", aspectRatio: "16:9", scenes });
    expect(base).toBe(photoSlideshowSourceSignature({ projectId: "p1", aspectRatio: "16:9", scenes }));
    expect(base).not.toBe(photoSlideshowSourceSignature({ projectId: "p1", aspectRatio: "9:16", scenes }));
    expect(base).not.toBe(photoSlideshowSourceSignature({
      projectId: "p1",
      aspectRatio: "16:9",
      scenes: [{ ...scenes[0], duration: 8 }],
    }));
  });

  test("maps supported aspect ratios to bounded even FFmpeg canvases", () => {
    expect(slideshowCanvas("16:9")).toEqual({ width: 1280, height: 720 });
    expect(slideshowCanvas("9:16")).toEqual({ width: 720, height: 1280 });
    expect(slideshowCanvas("1:1")).toEqual({ width: 1080, height: 1080 });
    expect(slideshowCanvas("4:3")).toEqual({ width: 960, height: 720 });
    expect(slideshowCanvas("21:9")).toEqual({ width: 1260, height: 540 });
  });

  test("builds deterministic Ken Burns and drift filters at 24 fps", () => {
    expect(slideshowMotionForIndex(0)).toBe("gentle_zoom");
    expect(slideshowMotionForIndex(1)).toBe("drift_right");
    expect(slideshowMotionForIndex(2)).toBe("drift_left");
    expect(slideshowMotionForIndex(3)).toBe("drift_up");
    const filter = slideshowVideoFilter("16:9", 6, "gentle_zoom");
    expect(filter).toContain("zoompan=");
    expect(filter).toContain("1280x720");
    expect(filter).toContain("fps=24");
    expect(filter).toContain("format=yuv420p");
  });

  test("renderer stays local, durable and provider-free", () => {
    const renderer = read("src/lib/photo-slideshow-render.ts");
    expect(renderer).toContain('"ffmpeg"');
    expect(renderer).toContain("promoteGeneratedFile");
    expect(renderer).toContain("photo-slideshow-");
    expect(renderer).toContain("providerCostUsd: 0");
    expect(renderer).toContain("creditsCharged: 0");
    expect(renderer).not.toContain("@/lib/zai");
    expect(renderer).not.toContain("generateVideo(");
    const unlock = renderer.indexOf("data: { activeKey: null, progress: 92");
    const sceneWrite = renderer.indexOf("await tx.videoScene.update");
    expect(unlock).toBeGreaterThan(0);
    expect(sceneWrite).toBeGreaterThan(unlock);
  });

  test("queue endpoint validates ownership, local sources and zero-credit contract", () => {
    const route = read("src/app/api/photo-studio/slideshow/route.ts");
    expect(route).toContain("requireProjectAccess(projectId, true)");
    expect(route).toContain('project.projectType !== "photo-slideshow"');
    expect(route).toContain("resolvePublicAssetPath(sourceUrl)");
    expect(route).toContain("activeKey");
    expect(route).toContain("project:");
    expect(route).toContain('mode: "photo_slideshow"');
    expect(route).toContain("providerCostUsd: 0");
    expect(route).toContain("creditsRequired: 0");
    expect(route).not.toContain("zai.");
  });

  test("worker claims and dispatches both review previews and local slideshows", () => {
    const worker = read("scripts/export-worker.ts");
    const dispatcher = read("src/lib/export-job-dispatch.ts");
    expect(worker).toContain('%"mode":"preview"%');
    expect(worker).toContain('%"mode":"photo_slideshow"%');
    expect(dispatcher).toContain('mode === "preview"');
    expect(dispatcher).toContain('mode === "photo_slideshow"');
    expect(dispatcher).toContain("runPhotoSlideshowJob(jobId)");
  });

  test("database guard allows only explicit pre-review slideshow/preview modes", () => {
    const migration = read("prisma/migrations/20260918134000_allow_photo_slideshow_jobs_before_review/migration.sql");
    expect(migration).toContain("job_mode TEXT := \'final\'");
    expect(migration).toContain("job_mode IN (\'preview\', \'photo_slideshow\')");
    expect(migration).toContain("VIDORA_PREVIEW_REQUIRED");
  });

  test("slideshow jobs cannot masquerade as final exports or Full Preview", () => {
    const mode = read("src/lib/media-job-mode.ts");
    const exportRoute = read("src/app/api/export-video/route.ts");
    const previewRoute = read("src/app/api/concatenate-video/route.ts");
    expect(mode).toContain('"photo_slideshow"');
    expect(mode).toContain('return "final"');
    expect(exportRoute).toContain("slideshowActiveResponse");
    expect(exportRoute).toContain('mode === "photo_slideshow"');
    expect(exportRoute).toContain('mediaJobMode(activeJob.params) !== "final"');
    expect(previewRoute).toContain("VIDORA_SLIDESHOW_ACTIVE");
  });

  test("Photo Studio exposes live zero-credit local rendering", () => {
    const page = read("src/app/photo-studio/page.tsx");
    const projectsRoute = read("src/app/api/photo-studio/projects/route.ts");
    expect(page).toContain('fetch("/api/photo-studio/slideshow"');
    expect(page).toContain("/api/export-video?jobId=");
    expect(page).toContain("Render locally · 0 credits");
    expect(page).toContain("AI credits: 0");
    expect(projectsRoute).toContain('generationRequired: mode !== "slideshow"');
    expect(projectsRoute).toContain('localRenderAvailable: mode === "slideshow"');
  });
});