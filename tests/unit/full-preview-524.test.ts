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

  test("preview response emits legal JSON whitespace heartbeats through nginx/cloudflare", () => {
    const route = read("src/app/api/concatenate-video/route.ts");
    expect(route).toContain("PREVIEW_STREAM_HEARTBEAT_MS = 10_000");
    expect(route).toContain('safeEnqueue("\\n")');
    expect(route).toContain('"X-Accel-Buffering": "no"');
    expect(route).toContain('"Cache-Control": "no-cache, no-store, no-transform"');
  });

  test("export worker dispatches preview jobs to the durable preview renderer", () => {
    const worker = read("scripts/export-worker.ts");
    const dispatcher = read("src/lib/export-job-dispatch.ts");
    const previewJob = read("src/lib/full-preview-job.ts");
    expect(worker).toContain("runQueuedMediaJob(jobId)");
    expect(dispatcher).toContain('jobMode(job.params) === "preview"');
    expect(dispatcher).toContain("runFullPreviewJob(jobId)");
    expect(previewJob).toContain("renderFullProjectPreview");
    expect(previewJob).toContain("markCurrentCutReviewed");
    expect(previewJob).toContain("activeKey: null");
  });
});
