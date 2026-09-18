import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";
import {
  buildDirectedPhotoPrompt,
  extractCustomPhotoMotionDirection,
  photoMotionPresetFromCameraMove,
  resolvePhotoMotionDirection,
  sanitizePhotoMotionCustomDirection,
  sanitizePhotoMotionPreset,
} from "../../src/lib/photo-studio-motion";

function read(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("Photo Studio Motion Director", () => {
  test("normalizes bounded provider-free direction presets", () => {
    expect(sanitizePhotoMotionPreset("cinematic_push")).toBe("cinematic_push");
    expect(sanitizePhotoMotionPreset("unknown")).toBe("natural");
    expect(sanitizePhotoMotionCustomDirection("  slow   push  ")).toBe("slow push");
    expect(sanitizePhotoMotionCustomDirection("x".repeat(900))).toHaveLength(500);

    const direction = resolvePhotoMotionDirection("portrait_alive");
    expect(direction.cameraMove).toBe("portrait");
    expect(direction.instruction).toContain("identity");
    expect(() => resolvePhotoMotionDirection("custom", "   ")).toThrow(
      "Custom motion direction is required",
    );
  });

  test("builds deterministic prompts and restores saved UI state", () => {
    const direction = resolvePhotoMotionDirection("custom", "Slow push toward the subject");
    const prompt = buildDirectedPhotoPrompt("Preserve the uploaded photograph.", direction);
    expect(prompt).toContain("Preserve the uploaded photograph.");
    expect(prompt).toContain("Motion Director (Custom direction): Slow push toward the subject");
    expect(photoMotionPresetFromCameraMove("custom")).toBe("custom");
    expect(extractCustomPhotoMotionDirection(prompt)).toBe("Slow push toward the subject");
  });

  test("motion endpoint is owner-scoped, pre-generation only and provider-free", () => {
    const route = read("src/app/api/photo-studio/projects/[id]/motion/[sceneId]/route.ts");

    expect(route).toContain("requireProjectAccess(id, true)");
    expect(route).toContain('project.projectType !== "photo-animation"');
    expect(route).toContain('activeKey: `project:${id}`');
    expect(route).toContain("PHOTO_STUDIO_GENERATION_ACTIVE");
    expect(route).toContain("scene.videoUrl || scene.taskId");
    expect(route).toContain('"queued", "submitting", "generating"');
    expect(route).toContain("resolvePhotoMotionDirection");
    expect(route).toContain("buildDirectedPhotoPrompt");
    expect(route).toContain("providerCostUsd: 0");
    expect(route).toContain("creditsRequired: 0");
    expect(route).not.toContain("@/lib/zai");
    expect(route).not.toContain("generateVideo(");
  });

  test("Photo Studio exposes per-scene controls before the billed Living Photo action", () => {
    const component = read("src/components/PhotoMotionDirector.tsx");
    const page = read("src/app/photo-studio/page.tsx");

    expect(component).toContain("Motion Director");
    expect(component).toContain("0 credits to direct");
    expect(component).toContain("PHOTO_MOTION_PRESETS");
    expect(component).toContain("maxLength={500}");
    expect(component).toContain("onDirtyChange");
    expect(component).toContain("onDirtyChange?.(Object.values(dirty).some(Boolean))");
    expect(component).toContain("/api/photo-studio/projects/");
    expect(component).toContain("/motion/");
    expect(component).not.toContain("/api/generate-video");

    const directorIndex = page.indexOf("<PhotoMotionDirector");
    const generationIndex = page.indexOf("Review cost & animate");
    expect(directorIndex).toBeGreaterThan(0);
    expect(generationIndex).toBeGreaterThan(directorIndex);
    expect(page).toContain("locked={generatingLivingPhotos || livingPhotoGeneration !== null}");
    expect(page).toContain("onDirtyChange={setMotionDirectorDirty}");
    expect(page).toContain("motionDirectorDirty ||");
    expect(page).toContain("Save motion directions first");
  });
});
