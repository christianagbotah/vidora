import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";

function source(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8");
}

describe("direct final-export delivery", () => {
  test("streams final media to ffmpeg stdout instead of persistent generated storage", () => {
    const exporter = source("src", "lib", "direct-export-stream.ts");

    expect(exporter).toContain('"pipe:1"');
    expect(exporter).toContain("+frag_keyframe+empty_moov+default_base_moof");
    expect(exporter).toContain('mkdtemp(path.join(os.tmpdir(), "vidora-export-"))');
    expect(exporter).toContain("persistedOnServer: false");
    expect(exporter).toContain("finalVideoUrl: null");
    expect(exporter).not.toContain("promoteGeneratedFile");
    expect(exporter).not.toContain("saveGeneratedFile");
  });

  test("download response is an attachment and explicitly non-cacheable", () => {
    const route = source("src", "app", "api", "export-video", "download", "route.ts");

    expect(route).toContain('"Content-Disposition"');
    expect(route).toContain('"Cache-Control": "private, no-store, no-cache, must-revalidate"');
    expect(route).toContain('"X-Accel-Buffering": "no"');
    expect(route).toContain("Readable.toWeb(output)");
    expect(route).toContain("streamDirectExportJob(jobId, output, req.signal)");
  });

  test("final export POST returns a direct browser download URL and expires sessions atomically", () => {
    const route = source("src", "app", "api", "export-video", "route.ts");

    expect(route).toContain("autoDownload: true");
    expect(route).toContain('delivery: "direct_stream"');
    expect(route).toContain("persistedOnServer: false");
    expect(route).toContain("directDownloadUrl(job.id)");
    expect(route).toContain("updatedAt: { lt: staleBefore }");
    expect(route).toContain("return released.count === 1");
  });

  test("background export worker only claims preview jobs", () => {
    const worker = source("scripts", "export-worker.ts");
    const dispatch = source("src", "lib", "export-job-dispatch.ts");

    expect(worker).toContain('"params" LIKE \'%"mode":"preview"%\'');
    expect(worker).toContain("preview jobs only");
    expect(dispatch).toContain('jobMode(job.params) !== "preview"');
    expect(dispatch).not.toContain('runExportJob(jobId)');
  });

  test("client bridge automatically starts the download and suppresses the legacy second gate", () => {
    const bridge = source("src", "components", "ExportDownloadBridge.tsx");
    const layout = source("src", "app", "layout.tsx");

    expect(bridge).toContain("beginBrowserDownload(data.downloadUrl)");
    expect(bridge).toContain('status: "downloaded"');
    expect(bridge).toContain("vidora:direct-export-jobs");
    expect(layout).toContain("<ExportDownloadBridge />");
  });
});
