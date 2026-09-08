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
    const core = source("src/app/api/export-video/route-core.ts");
    expect(route).toContain('import { GET as getCoreExportStatus, runExportJob as runCoreExportJob } from "./route-core"');
    expect(route).toContain("export async function runExportJob(jobId: string)");
    expect(route).toContain("await runCoreExportJob(jobId)");
    expect(route).toContain("enforceProjectFinalExportRetention(job.projectId");
    expect(core).toContain("resolveSceneLanguageText(scene.id, language)");
    expect(core).toContain("language,");
    expect(core).toContain("accent: scene.narrationAccent || undefined");
    expect(core).toContain("style: scene.narrationStyle || undefined");
    expect(core).toContain("materializeSceneVideo(scene)");
  });

  test("final export project recovery excludes Full Preview jobs", () => {
    const route = source("src/app/api/export-video/route.ts");
    expect(route).toContain('where: { activeKey: `project:${projectId}` }');
    expect(route).toContain('mediaJobMode(activeJob.params) === "preview"');
    expect(route).toContain("return NextResponse.json({ success: true, job: null })");
    expect(route).toContain('forwardedUrl.searchParams.set("jobId", activeJob.id)');
  });

  test("production provider preflight exercises the dedicated Z.AI GLM-TTS route", () => {
    const preflight = source("scripts/check-ai-provider-routing-live.ts");
    expect(preflight).toContain("getZaiTtsSettings");
    expect(preflight).toContain("ttsWithRequiredModel");
    expect(preflight).toContain("await probeZaiTts()");
    expect(preflight).not.toContain("TTS zai: credential covered by Z.ai live preflight");
  });
});
