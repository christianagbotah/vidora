import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";

function source(file: string): string {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

describe("language and export pipeline regression guards", () => {
  test("narration route auto-resolves translations and no longer requires legacy dubbing", () => {
    const route = source("src/app/api/generate-narration/route.ts");
    expect(route).toContain("resolveSceneLanguageText(sceneId, profile.language)");
    expect(route).not.toContain("TRANSLATION_REQUIRED");
    expect(route).toContain("narrationUrl: null");
  });

  test("full preview treats voice generation as optional and uses selected language", () => {
    const preview = source("src/lib/full-preview-render.ts");
    expect(preview).toContain("resolveSceneLanguageText(scene.id, language)");
    expect(preview).toContain("voice generation skipped");
    expect(preview).not.toContain("Apply the video language again before previewing");
  });

  test("final export carries language profile and uses resilient scene media materialization", () => {
    const route = source("src/app/api/export-video/route.ts");
    expect(route).toContain("resolveSceneLanguageText(scene.id, language)");
    expect(route).toContain("language,");
    expect(route).toContain("accent: scene.narrationAccent || undefined");
    expect(route).toContain("style: scene.narrationStyle || undefined");
    expect(route).toContain("materializeSceneVideo(scene)");
  });

  test("production provider preflight exercises the dedicated Z.AI GLM-TTS route", () => {
    const preflight = source("scripts/check-ai-provider-routing-live.ts");
    expect(preflight).toContain("getZaiTtsSettings");
    expect(preflight).toContain("ttsWithRequiredModel");
    expect(preflight).toContain("await probeZaiTts()");
    expect(preflight).not.toContain("TTS zai: credential covered by Z.ai live preflight");
  });
});
