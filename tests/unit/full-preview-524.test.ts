import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";

function read(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("full preview Cloudflare timeout regression", () => {
  test("concatenate preview queues a durable preview job instead of rendering in the request", () => {
    const route = read("src/app/api/concatenate-video/route.ts");
    expect(route).toContain('mode: "preview"');
    expect(route).toContain('activeKey = `project:${projectId}`');
    expect(route).toContain("streamFullPreviewJob(job.id)");
    expect(route).not.toContain("await renderFullProjectPreview(");
  });

  test("worker-backed preview does not depend on the web process FFmpeg PATH", () => {
    const route = read("src/app/api/concatenate-video/route.ts");
    const previewBranch = route.indexOf("if (previewOnly)");
    const legacyFfmpegStage = route.indexOf('stage = "legacy-ffmpeg-preflight"');
    const ffmpegCheck = route.indexOf("const hasFfmpeg = await checkFfmpeg()", previewBranch);
    expect(previewBranch).toBeGreaterThan(-1);
    expect(legacyFfmpegStage).toBeGreaterThan(previewBranch);
    expect(ffmpegCheck).toBeGreaterThan(legacyFfmpegStage);
  });

  test("pre-queue failures identify the exact production stage instead of collapsing to one generic 500", () => {
    const route = read("src/app/api/concatenate-video/route.ts");
    expect(route).toContain('stage = "auth"');
    expect(route).toContain('stage = "project-load"');
    expect(route).toContain('stage = "queue-lookup"');
    expect(route).toContain('stage = "queue-create"');
    expect(route).toContain('code: "VIDORA_CONCATENATE_INTERNAL"');
    expect(route).toContain('code: "VIDORA_DATABASE_SCHEMA_MISMATCH"');
    expect(route).toContain("requestId");
  });

  test("preview response emits legal JSON whitespace heartbeats through nginx/cloudflare", () => {
    const route = read("src/app/api/concatenate-video/route.ts");
    expect(route).toContain("PREVIEW_STREAM_HEARTBEAT_MS = 10_000");
    expect(route).toContain('safeEnqueue("\\n")');
    expect(route).toContain('"X-Accel-Buffering": "no"');
    expect(route).toContain('"Cache-Control": "no-cache, no-store, no-transform"');
  });

  test("export worker dispatches only preview jobs to the durable preview renderer", () => {
    const worker = read("scripts/export-worker.ts");
    const dispatcher = read("src/lib/export-job-dispatch.ts");
    const previewJob = read("src/lib/full-preview-job.ts");
    expect(worker).toContain("runQueuedMediaJob(jobId)");
    expect(worker).toContain('"params" LIKE \'%"mode":"preview"%\'');
    expect(dispatcher).toContain('jobMode(job.params) !== "preview"');
    expect(dispatcher).toContain("runFullPreviewJob(jobId)");
    expect(dispatcher).not.toContain("runExportJob(jobId)");
    expect(previewJob).toContain("renderFullProjectPreview");
    expect(previewJob).toContain("markCurrentCutReviewed");
    expect(previewJob).toContain("activeKey: null");
  });

  test("missing local scene clips are recovered from existing provider tasks without a new generation submit", () => {
    const previewJob = read("src/lib/full-preview-job.ts");
    expect(previewJob).toContain("recoverMissingLocalSceneVideos");
    expect(previewJob).toContain("existsSync(localPath)");
    expect(previewJob).toContain("zai.pollVideoTask({");
    expect(previewJob).toContain("persistProviderVideo(scene.id, refreshed.videoUrl)");
    expect(previewJob).toContain("data: { videoUrl: recoveredUrl, errorMessage: null }");
    expect(previewJob).not.toContain("zai.generateVideo(");
  });

  test("unrecoverable deleted scene media gives an actionable regenerate-scene error", () => {
    const previewJob = read("src/lib/full-preview-job.ts");
    expect(previewJob).toContain("source video is missing from storage");
    expect(previewJob).toContain("Regenerate this scene before building Full Preview.");
    expect(previewJob).toContain('if (/source video is missing from storage/i.test(message))');
  });
});
