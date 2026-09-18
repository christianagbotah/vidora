import { execFile } from "child_process";
import { promisify } from "util";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { currentCutIsReviewed, mediaJobMode } from "@/lib/media-job-mode";
import { requireProjectAccess } from "@/lib/project-auth";
import { GET as getCoreExportStatus } from "./route-core";

export type { ExportAudioSummary } from "./route-core";

const execFileAsync = promisify(execFile);
const QUALITY_PRESETS = ["draft", "standard", "high", "ultra"] as const;
const TRANSITIONS = ["fade", "dissolve", "wipe", "slide", "cut"] as const;
const FORMATS = ["mp4", "webm"] as const;
const DIRECT_EXPORT_STALE_MS = 3 * 60 * 1000;

async function checkFfmpeg(): Promise<boolean> {
  try {
    await execFileAsync("which", ["ffmpeg"]);
    await execFileAsync("which", ["ffprobe"]);
    return true;
  } catch {
    return false;
  }
}

function directDownloadUrl(jobId: string): string {
  return `/api/export-video/download?jobId=${encodeURIComponent(jobId)}`;
}

function previewActiveResponse(jobId?: string): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: "A Full Preview is already queued or running. Wait for it to finish before starting the final export.",
      code: "VIDORA_PREVIEW_ACTIVE",
      ...(jobId ? { jobId } : {}),
    },
    { status: 409 },
  );
}

function slideshowActiveResponse(jobId?: string): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: "Photo Studio is still rendering local slideshow clips. Wait for it to finish before starting Full Preview or final export.",
      code: "VIDORA_SLIDESHOW_ACTIVE",
      ...(jobId ? { jobId } : {}),
    },
    { status: 409 },
  );
}

function previewRequiredResponse(): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: "Build and review Full Preview for the current cut before starting the final export.",
      code: "VIDORA_PREVIEW_REQUIRED",
    },
    { status: 409 },
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function releaseStaleFinalJob(job: {
  id: string;
  status: string;
  updatedAt: Date;
  params: string | null;
}): Promise<boolean> {
  if (mediaJobMode(job.params) !== "final") return false;
  if (!["queued", "running"].includes(job.status)) return false;
  const staleBefore = new Date(Date.now() - DIRECT_EXPORT_STALE_MS);
  if (job.updatedAt >= staleBefore) return false;

  // Re-check staleness atomically in the UPDATE. A live direct stream writes a
  // heartbeat every 10s, so a heartbeat that lands after our read must prevent
  // this cleanup path from expiring the active browser download.
  const released = await db.exportJob.updateMany({
    where: {
      id: job.id,
      activeKey: { not: null },
      status: { in: ["queued", "running"] },
      updatedAt: { lt: staleBefore },
    },
    data: {
      status: "failed",
      activeKey: null,
      step: "Download session expired",
      error: "The previous browser download session ended unexpectedly. Start a new export to retry.",
      updatedAt: new Date(),
    },
  });
  return released.count === 1;
}

function resumedFinalJob(job: {
  id: string;
  status: string;
  progress: number;
  step: string;
}) {
  const canStartDownload = job.status === "queued";
  return NextResponse.json({
    success: true,
    jobId: job.id,
    resumed: true,
    progress: job.progress,
    step: job.step,
    autoDownload: canStartDownload,
    downloadUrl: canStartDownload ? directDownloadUrl(job.id) : null,
  });
}

/**
 * Prepare a one-time final export download session.
 *
 * Final media is no longer rendered by the export worker or promoted into the
 * persistent generated store. The browser starts the returned downloadUrl;
 * that request renders ffmpeg output directly to the HTTP response stream.
 * ExportJob remains as durable progress/audit metadata only.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
    if (!projectId) {
      return NextResponse.json({ success: false, error: "Project ID is required" }, { status: 400 });
    }

    const authResult = await requireProjectAccess(projectId, true);
    if (!authResult.ok) return authResult.response;

    const quality = typeof body.quality === "string" ? body.quality : "standard";
    const transition = typeof body.transition === "string" ? body.transition : "fade";
    const format = typeof body.format === "string" ? body.format : "mp4";
    const withTitleCard = body.withTitleCard === true;
    const includeAudio = body.includeAudio !== false;

    if (!QUALITY_PRESETS.includes(quality as (typeof QUALITY_PRESETS)[number])) {
      return NextResponse.json(
        { success: false, error: `Invalid quality: "${quality}". Must be one of: ${QUALITY_PRESETS.join(", ")}` },
        { status: 400 },
      );
    }
    if (!TRANSITIONS.includes(transition as (typeof TRANSITIONS)[number])) {
      return NextResponse.json(
        { success: false, error: `Invalid transition: "${transition}". Must be one of: ${TRANSITIONS.join(", ")}` },
        { status: 400 },
      );
    }
    if (!FORMATS.includes(format as (typeof FORMATS)[number])) {
      return NextResponse.json(
        { success: false, error: `Invalid format: "${format}". Must be mp4 or webm` },
        { status: 400 },
      );
    }

    if (!(await checkFfmpeg())) {
      return NextResponse.json(
        { success: false, error: "ffmpeg/ffprobe is not installed on the server." },
        { status: 500 },
      );
    }

    const project = await db.videoProject.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        cutVersion: true,
        reviewedCutVersion: true,
        scenes: {
          orderBy: { sceneNumber: "asc" },
          select: { videoUrl: true },
        },
      },
    });
    if (!project) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }
    if (!project.scenes.some((scene) => Boolean(scene.videoUrl))) {
      return NextResponse.json({ success: false, error: "No completed video scenes to export" }, { status: 400 });
    }

    const activeKey = `project:${projectId}`;
    let activeJob = await db.exportJob.findUnique({ where: { activeKey } });
    if (activeJob && await releaseStaleFinalJob(activeJob)) {
      activeJob = null;
    }
    if (activeJob) {
      const mode = mediaJobMode(activeJob.params);
      if (mode === "preview") return previewActiveResponse(activeJob.id);
      if (mode === "photo_slideshow") return slideshowActiveResponse(activeJob.id);
      return resumedFinalJob(activeJob);
    }

    if (!currentCutIsReviewed(project)) return previewRequiredResponse();

    let job;
    try {
      job = await db.exportJob.create({
        data: {
          projectId,
          userId: authResult.session.userId && authResult.session.userId !== "guest"
            ? authResult.session.userId
            : null,
          activeKey,
          status: "queued",
          progress: 0,
          step: "Waiting for browser download",
          params: JSON.stringify({
            mode: "final",
            delivery: "direct_stream",
            expectedCutVersion: project.cutVersion,
            quality,
            transition,
            format,
            withTitleCard,
            includeAudio,
          }),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const concurrent = await db.exportJob.findUnique({ where: { activeKey } });
        if (concurrent) {
          const mode = mediaJobMode(concurrent.params);
          if (mode === "preview") return previewActiveResponse(concurrent.id);
          if (mode === "photo_slideshow") return slideshowActiveResponse(concurrent.id);
          return resumedFinalJob(concurrent);
        }
      }
      if (errorText(error).includes("VIDORA_PREVIEW_REQUIRED")) return previewRequiredResponse();
      throw error;
    }

    return NextResponse.json({
      success: true,
      jobId: job.id,
      autoDownload: true,
      downloadUrl: directDownloadUrl(job.id),
      delivery: "direct_stream",
      persistedOnServer: false,
    });
  } catch (error) {
    console.error("[Export] Failed to prepare direct download:", error);
    return NextResponse.json({ success: false, error: "Failed to start export" }, { status: 500 });
  }
}

async function expireStaleDirectJob(jobId: string): Promise<void> {
  const job = await db.exportJob.findUnique({ where: { id: jobId } });
  if (!job || mediaJobMode(job.params) !== "final") return;
  await releaseStaleFinalJob(job);
}

/**
 * Keep the existing status contract for Studio polling, but final jobs are now
 * driven by the browser download request rather than the background worker.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("jobId");
  const projectId = searchParams.get("projectId");

  if (jobId) {
    await expireStaleDirectJob(jobId);
    return getCoreExportStatus(req);
  }
  if (!projectId) return getCoreExportStatus(req);

  const authResult = await requireProjectAccess(projectId, false);
  if (!authResult.ok) return authResult.response;

  const activeJob = await db.exportJob.findUnique({
    where: { activeKey: `project:${projectId}` },
    select: { id: true, params: true },
  });
  if (!activeJob || mediaJobMode(activeJob.params) !== "final") {
    return NextResponse.json({ success: true, job: null });
  }

  await expireStaleDirectJob(activeJob.id);
  const forwardedUrl = new URL(req.url);
  forwardedUrl.searchParams.delete("projectId");
  forwardedUrl.searchParams.set("jobId", activeJob.id);
  return getCoreExportStatus(new NextRequest(forwardedUrl, { method: "GET", headers: req.headers }));
}
