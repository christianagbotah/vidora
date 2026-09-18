import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";
import {
  buildPhotoScenePrompt,
  detectImageExtension,
  normalizeAssetIds,
  sanitizeAspectRatio,
  sanitizePerformanceProfile,
  parseStoredPerformanceProfile,
  performanceDirection,
  sanitizePhotoStudioMode,
  sanitizeSecondsPerPhoto,
} from "../../src/lib/photo-studio";

function read(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("Photo & Character Studio foundation", () => {
  test("accepts only real supported image signatures", () => {
    const png = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3]);
    const jpg = new Uint8Array([0xff,0xd8,0xff,0xdb,1,2,3]);
    const webp = new Uint8Array([0x52,0x49,0x46,0x46,1,2,3,4,0x57,0x45,0x42,0x50]);
    expect(detectImageExtension(png, "image/png")).toBe("png");
    expect(detectImageExtension(jpg, "image/jpeg")).toBe("jpg");
    expect(detectImageExtension(webp, "image/webp")).toBe("webp");
    expect(detectImageExtension(png, "image/jpeg")).toBeNull();
    expect(detectImageExtension(new Uint8Array([1,2,3]), "image/png")).toBeNull();
  });

  test("normalizes bounded project settings and asset selection", () => {
    expect(normalizeAssetIds(["a", "a", "b", "", 5])).toEqual(["a", "b"]);
    expect(normalizeAssetIds(Array.from({ length: 30 }, (_, index) => `a${index}`))).toHaveLength(12);
    expect(sanitizeAspectRatio("9:16")).toBe("9:16");
    expect(sanitizeAspectRatio("invalid")).toBe("16:9");
    expect(sanitizeSecondsPerPhoto(99)).toBe(10);
    expect(sanitizeSecondsPerPhoto(1)).toBe(3);
    expect(sanitizePhotoStudioMode("slideshow")).toBe("slideshow");
    expect(sanitizePhotoStudioMode("anything")).toBe("animate");
  });

  test("keeps reusable performance direction structured and bounded", () => {
    expect(sanitizePerformanceProfile({
      emotion: "confident",
      gestureIntensity: "high",
      eyeContact: "natural",
      bodyMotion: "expressive",
      actingStyle: "corporate presenter",
    })).toEqual({
      emotion: "confident",
      gestureIntensity: "high",
      eyeContact: "natural",
      bodyMotion: "expressive",
      actingStyle: "corporate presenter",
    });
    expect(sanitizePerformanceProfile({
      gestureIntensity: "wild",
      eyeContact: "unknown",
      bodyMotion: "chaos",
    }).gestureIntensity).toBe("medium");
    const stored = parseStoredPerformanceProfile(JSON.stringify({ emotion: "joyful", gestureIntensity: "high" }));
    expect(stored.emotion).toBe("joyful");
    expect(performanceDirection(stored)).toContain("high gesture intensity");
  });

  test("photo prompts explicitly preserve source identity and composition", () => {
    const animate = buildPhotoScenePrompt("animate", 0, 3, "Ama");
    const slideshow = buildPhotoScenePrompt("slideshow", 1, 3, null);
    expect(animate).toContain("Preserve identity and composition");
    expect(animate).toContain("Keep Ama visually identical");
    expect(animate).toContain("Do not change age, face, body shape, wardrobe");
    expect(slideshow).toContain("Preserve the uploaded photograph faithfully");
  });

  test("uploads are owner-scoped, deduplicated and provider-free", () => {
    const route = read("src/app/api/photo-studio/assets/route.ts");
    expect(route).toContain("requireAuth()");
    expect(route).toContain("userId: auth.session.userId");
    expect(route).toContain("sha256");
    expect(route).toContain("mediaAsset.upsert");
    expect(route).toContain("userId_sha256");
    expect(route).toContain("users/${auth.session.userId}/photo-studio/");
    expect(route).not.toContain("zai.");
    expect(route).not.toContain("generateVideo");
  });

  test("Character Forge requires explicit consent and user-owned references", () => {
    const route = read("src/app/api/photo-studio/characters/route.ts");
    expect(route).toContain("body.consentConfirmed !== true");
    expect(route).toContain("userId: auth.session.userId");
    expect(route).toContain('consentStatus: "confirmed"');
    expect(route).toContain("consentConfirmedAt: new Date()");
  });

  test("photo projects reuse Vidora scenes and defer paid motion until explicit generation", () => {
    const route = read("src/app/api/photo-studio/projects/route.ts");
    expect(route).toContain("referenceImageUrl: asset.url");
    expect(route).toContain("imageUrl: asset.url");
    expect(route).toContain('status: "pending"');
    expect(route).toContain('generationRequired: mode !== "slideshow"');
    expect(route).toContain('localRenderAvailable: mode === "slideshow"');
    expect(route).toContain("sourceProfileId: profile.id");
    expect(route).toContain("performanceDirection(savedPerformance)");
    expect(route).not.toContain("zai.");
    expect(route).not.toContain("generateVideo");
  });

  test("schema, migration and deployment contract make the foundation durable", () => {
    const schema = read("prisma/schema.prisma");
    const migration = read("prisma/migrations/20260918121500_photo_character_studio_foundation/migration.sql");
    const contract = read("scripts/check-runtime-db-contract.ts");
    expect(schema).toContain("model MediaAsset");
    expect(schema).toContain("model CharacterProfile");
    expect(schema).toContain("sourceProfileId String?");
    expect(schema).toContain("@@unique([userId, sha256])");
    expect(migration).toContain('CREATE TABLE "MediaAsset"');
    expect(migration).toContain('CREATE TABLE "CharacterProfile"');
    expect(migration).toContain('"MediaAsset_userId_sha256_key"');
    expect(contract).toContain("requiredPhotoStudioTables");
    expect(contract).toContain("Character.sourceProfileId is missing");
  });

  test("the workspace is discoverable from the root Vidora experience", () => {
    const layout = read("src/app/layout.tsx");
    const launcher = read("src/components/PhotoStudioLauncher.tsx");
    const page = read("src/app/photo-studio/page.tsx");
    expect(layout).toContain("<PhotoStudioLauncher />");
    expect(launcher).toContain('href="/photo-studio"');
    expect(page).toContain("Vidora Photo & Character Studio");
    expect(page).toContain("Upload & project setup do not spend AI credits");
  });
});
