import { execFile } from "child_process";
import { promisify } from "util";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { enforceProjectFinalExportRetention } from "@/lib/final-export-retention";
import { currentCutIsReviewed, mediaJobMode } from "@/lib/media-job-mode";
import { requireProjectAccess } from "@/lib/project-auth";
import { GET as getCoreExportStatus, runExportJob as runCoreExportJob } from "./route-core";

export type { ExportAudioSummary } from "./route-core";

const execFileAsync = promisify(execFile);
const QUALITY_PRESETS = ["draft", "standard", "high", "ultra"] as const;
const TRANSITIONS = ["fade", "dissolve", "wipe", "slide", "cut"] as const;
const FORMATS = ["mp4", "webm"] as const;

async function checkFfmpeg(): Promise<boolean> {
  try {
    await execFileAsync("which", ["ffmpeg"]);
    await execFileAsync("which", ["ffprobe"]);
    return true;
  } catch {
    return false;
  }
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

function resumedFinalJob(job: {
  id: string;
  progress: number;
  step: string;
}) {
  return NextResponse.json({
    success: true,
    jobId: job.id,
    resumed: true,
    progress: job.progress,
    step: job.step,
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function completedFinalVideoUrl(result: string | null): string | null {
  if (!result) return null;
  try {
    const parsed = JSON.parse(result) as { finalVideoUrl?: unknown };
    return typeof parsed.finalVideoUrl === "string" ? parsed.finalVideoUrl : null;
  } catch {
    return null;
  }
}

/**
 * Durable final-export worker boundary.
 *
 * The core exporter owns rendering and the terminal ExportJob write. Retention
 * runs only after that durable success state exists, and it is deliberately
 * best-effort so cleanup can never turn a valid export into a failed user job.
 */
export async function runExportJob(jobId: string): Promise<void> {
  await runCoreExportJob(jobId);

  const job = await db.exportJob.findUnique({
    where: { id: jobId },
    select: { projectId: true, status: true, params: true, result: true },
  });
  if (!job || job.status !== "done" || mediaJobMode(job.params) !== "final") return;

  const finalVideoUrl = completedFinalVideoUrl(job.result);
  const retention = await enforceProjectFinalExportRetention(job.projectId, {
    protectedUrls: finalVideoUrl ? [finalVideoUrl] : [],
  }).catch((error) => {
    console.warn(
      `[final-export-retention] project=${job.projectId} cleanup skipped:`,
      error instanceof Error ? error.message : "unknown error",
    );
    return null;
  });

  if (retention && (retention.deletedFiles > 0 || retention.expiredJobs > 0)) {
    console.log(
      `[final-export-retention] project=${job.projectId} deleted files=${retention.deletedFiles} expired jobs=${retention.expiredJobs}`,
    );
  }
}

/**
 * Final-export queue boundary.
 *
 * Preview and final export intentionally share one per-project activeKey. The
 * old route treated any active row as a resumable final export, which meant a
 * direct/multi-tab export request could receive a preview job id. Keep the
 * shared lock, but make the job mode explicit and fail with a precise 409 while
 * preview is active or the current cut has not been reviewed.
 *
 * The database trigger remains the authoritative fail-closed backstop for
 * races between this API validation and ExportJob insertion.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId } = body;
    if (!projectId) {
      return NextResponse.json(
        { success: false, error: "Project ID is required" },
        { status: 400 },
      );
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
        {
          success: false,
          error: `Invalid quality: "${quality}". Must be one of: ${QUALITY_PRESETS.join(", ")}`,
        },
        { status: 400 },
      );
    }
    if (!TRANSITIONS.includes(transition as (typeof TRANSITIONS)[number])) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid transition: "${transition}". Must be one of: ${TRANSITIONS.join(", ")}`,
        },
        { status: 400 },
      );
    }
    if (!FORMATS.includes(format as (typeof FORMATS)[number])) {
      return NextResponse.json(
        { success: false, error: `Invalid format: "${format}". Must be mp4 or webm` },
        { status: 400 },
      );
    }

    const hasFfmpeg = await checkFfmpeg();
    if (!hasFfmpeg) {
      return NextResponse.json(
        {
          success: false,
          error: "ffmpeg/ffprobe is not installed on the server. Please install them (e.g. sudo apt install ffmpeg) to export videos.",
        },
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
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 },
      );
    }

    const completedScenes = project.scenes.filter((scene) => Boolean(scene.videoUrl));
    if (completedScenes.length === 0) {
      return NextResponse.json(
        { success: false, error: "No completed video scenes to export" },
        { status: 400 },
      );
    }

    const activeKey = `project:${projectId}`;
    const activeJob = await db.exportJob.findUnique({ where: { activeKey } });
    if (activeJob) {
      if (mediaJobMode(activeJob.params) === "preview") {
        return previewActiveResponse(activeJob.id);
      }
      return resumedFinalJob(activeJob);
    }

    if (!currentCutIsReviewed(project)) {
      return previewRequiredResponse();
    }

    let job;
    try {
      job = await db.exportJob.create({
        data: {
          projectId,
          userId:
            authResult.session.userId && authResult.session.userId !== "guest"
              ? authResult.session.userId
              : null,
          activeKey,
          status: "queued",
          progress: 0,
          step: "Queued",
          params: JSON.stringify({
            mode: "final",
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
          if (mediaJobMode(concurrent.params) === "preview") {
            return previewActiveResponse(concurrent.id);
          }
          return resumedFinalJob(concurrent);
        }
      }

      // The reviewed-cut trigger can win a race if the cut changes after the
      // API read but before insert. Preserve the database guard and normalize
      // that expected business failure into the same precise API response.
      if (errorText(error).includes("VIDORA_PREVIEW_REQUIRED")) {
        return previewRequiredResponse();
      }
      throw error;
    }

    return NextResponse.json({ success: true, jobId: job.id });
  } catch (error) {
    console.error("[Export] Failed to start export:", error);
    return NextResponse.json(
      { success: false, error: "Failed to start export" },
      { status: 500 },
    );
  }
}

/**
 * Final-export status boundary.
 *
 * `GET ?projectId=...` is used by the Studio after reload to recover an active
 * background final export. Full Preview uses the same ExportJob table and the
 * same per-project activeKey, so returning a preview here would hydrate the
 * preview into the final-export progress UI. For project recovery, expose only
 * an active final job; explicit job-id polling keeps the core status behavior.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("jobId");
  const projectId = searchParams.get("projectId");

  if (jobId || !projectId) {
    return getCoreExportStatus(req);
  }

  const authResult = await requireProjectAccess(projectId, false);
  if (!authResult.ok) return authResult.response;

  const activeJob = await db.exportJob.findUnique({
    where: { activeKey: `project:${projectId}` },
    select: { id: true, params: true },
  });
  if (!activeJob || mediaJobMode(activeJob.params) === "preview") {
    return NextResponse.json({ success: true, job: null });
  }

  const forwardedUrl = new URL(req.url);
  forwardedUrl.searchParams.delete("projectId");
  forwardedUrl.searchParams.set("jobId", activeJob.id);
  const forwardedRequest = new NextRequest(forwardedUrl, {
    method: "GET",
    headers: req.headers,
  });
  return getCoreExportStatus(forwardedRequest);
}
