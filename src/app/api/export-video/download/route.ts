import { PassThrough, Readable } from "stream";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  directExportContentType,
  directExportFilename,
  directExportFormat,
  streamDirectExportJob,
} from "@/lib/direct-export-stream";
import { currentCutIsReviewed, mediaJobMode } from "@/lib/media-job-mode";
import { requireProjectAccess } from "@/lib/project-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function quotedFilename(name: string): string {
  return name.replace(/["\\\r\n]/g, "_");
}

export async function GET(req: NextRequest) {
  const jobId = new URL(req.url).searchParams.get("jobId")?.trim() || "";
  if (!jobId) {
    return NextResponse.json({ success: false, error: "jobId is required" }, { status: 400 });
  }

  const job = await db.exportJob.findUnique({ where: { id: jobId } });
  if (!job) {
    return NextResponse.json({ success: false, error: "Export job not found" }, { status: 404 });
  }
  if (mediaJobMode(job.params) !== "final") {
    return NextResponse.json({ success: false, error: "This job is not a final export" }, { status: 400 });
  }

  const access = await requireProjectAccess(job.projectId, false);
  if (!access.ok) return access.response;
  if (job.userId && job.userId !== access.session.userId && access.session.role !== "admin") {
    return NextResponse.json({ success: false, error: "Not authorized" }, { status: 403 });
  }

  const project = await db.videoProject.findUnique({
    where: { id: job.projectId },
    select: { id: true, title: true, cutVersion: true, reviewedCutVersion: true },
  });
  if (!project) {
    return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
  }
  if (!currentCutIsReviewed(project)) {
    return NextResponse.json(
      { success: false, error: "Review the current Full Preview before exporting." },
      { status: 409 },
    );
  }

  if (job.status === "running") {
    return NextResponse.json(
      { success: false, error: "This export is already streaming to a browser." },
      { status: 409 },
    );
  }
  if (job.status === "done") {
    return NextResponse.json(
      {
        success: false,
        error: "This one-time download session has already completed. Start a new export to download another copy.",
        code: "DIRECT_EXPORT_ALREADY_CONSUMED",
      },
      { status: 410 },
    );
  }
  if (job.status === "failed") {
    return NextResponse.json(
      { success: false, error: job.error || "This export session failed. Start a new export to retry." },
      { status: 409 },
    );
  }
  if (job.status !== "queued") {
    return NextResponse.json(
      { success: false, error: `Export session is ${job.status}.` },
      { status: 409 },
    );
  }

  const claimed = await db.exportJob.updateMany({
    where: { id: jobId, status: "queued", activeKey: { not: null } },
    data: {
      status: "running",
      progress: 1,
      step: "Starting secure browser download…",
      error: null,
      updatedAt: new Date(),
    },
  });
  if (claimed.count !== 1) {
    return NextResponse.json(
      { success: false, error: "This export was already claimed by another download request." },
      { status: 409 },
    );
  }

  const format = directExportFormat(job.params);
  const filename = directExportFilename(project.title, format);
  const output = new PassThrough({ highWaterMark: 1024 * 1024 });

  // Start the renderer after the response stream exists. The final container is
  // written to ffmpeg stdout and flows through this PassThrough to the browser;
  // there is no persistent final MP4/WebM file on the server.
  void streamDirectExportJob(jobId, output, req.signal);

  const body = Readable.toWeb(output) as unknown as ReadableStream<Uint8Array>;
  const safeName = quotedFilename(filename);
  const encodedName = encodeURIComponent(filename);

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": directExportContentType(format),
      "Content-Disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "private, no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
