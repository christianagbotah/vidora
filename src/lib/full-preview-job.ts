import { db } from "@/lib/db";
import {
  renderFullProjectPreview,
  type FullPreviewTransition,
} from "@/lib/full-preview-render";
import { enforceProjectReviewCutRetention } from "@/lib/review-cut-retention";

const PREVIEW_TRANSITIONS = new Set<FullPreviewTransition>([
  "fade",
  "dissolve",
  "wipe",
  "slide",
  "cut",
]);

interface PreviewJobParams {
  mode?: string;
  expectedCutVersion?: number;
  transition?: string;
  withTitleCard?: boolean;
  includeAudio?: boolean;
}

function parseParams(raw: string | null): PreviewJobParams {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as PreviewJobParams;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function markCurrentCutReviewed(
  projectId: string,
  expectedCutVersion: number,
): Promise<void> {
  const result = await db.videoProject.updateMany({
    where: { id: projectId, cutVersion: expectedCutVersion },
    data: { reviewedCutVersion: expectedCutVersion, reviewedAt: new Date() },
  });
  if (result.count !== 1) {
    throw new Error("Project changed while the full preview was being built");
  }
}

function friendlyPreviewError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/changed while|changed before/i.test(message)) {
    return "The project changed while the full preview was being built. Build the preview again to review the latest cut.";
  }
  if (/requires every scene|scene.*complete/i.test(message)) {
    return "Full preview requires every scene to be complete.";
  }
  if (/voice|narration|tts/i.test(message)) {
    return "Could not prepare one or more narration tracks for the full preview.";
  }
  if (/ffmpeg|encoding|render|media|video/i.test(message)) {
    return "Could not assemble the full project preview. Please retry in a moment.";
  }
  return "Could not build the full project preview.";
}

export async function runFullPreviewJob(jobId: string): Promise<void> {
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  try {
    const job = await db.exportJob.findUnique({ where: { id: jobId } });
    if (!job || job.status === "done" || job.status === "failed") return;

    const params = parseParams(job.params);
    if (params.mode !== "preview") {
      throw new Error("Export job is not a full-preview job");
    }

    const project = await db.videoProject.findUnique({
      where: { id: job.projectId },
      include: { scenes: { orderBy: { sceneNumber: "asc" } } },
    });
    if (!project) throw new Error("Project not found");

    const completedScenes = project.scenes.filter((scene) => Boolean(scene.videoUrl));
    if (completedScenes.length !== project.scenes.length || project.scenes.length === 0) {
      throw new Error(
        `Full preview requires every scene to be complete (${completedScenes.length}/${project.scenes.length} ready).`,
      );
    }

    const expectedCutVersion = Number.isInteger(params.expectedCutVersion)
      ? Number(params.expectedCutVersion)
      : project.cutVersion;
    const transition = PREVIEW_TRANSITIONS.has(params.transition as FullPreviewTransition)
      ? params.transition as FullPreviewTransition
      : "fade";

    await db.exportJob.update({
      where: { id: jobId },
      data: {
        status: "running",
        progress: 10,
        step: "Building full project preview…",
        error: null,
        updatedAt: new Date(),
      },
    });

    heartbeat = setInterval(() => {
      db.exportJob
        .update({ where: { id: jobId }, data: { updatedAt: new Date() } })
        .catch(() => undefined);
    }, 10_000);

    const preview = await renderFullProjectPreview(job.projectId, expectedCutVersion, {
      transition,
      withTitleCard: params.withTitleCard === true,
      includeAudio: params.includeAudio !== false,
    });

    await db.exportJob.update({
      where: { id: jobId },
      data: {
        progress: 92,
        step: "Saving preview review state…",
        updatedAt: new Date(),
      },
    });
    await markCurrentCutReviewed(job.projectId, expectedCutVersion);

    const min = Math.floor(preview.durationSeconds / 60);
    const sec = Math.round(preview.durationSeconds % 60);
    const duration = min > 0 ? `${min}m ${sec}s` : `${sec}s`;
    const payload = {
      success: true,
      previewVideoUrl: preview.previewVideoUrl,
      sceneCount: preview.sceneCount,
      reviewedCutVersion: expectedCutVersion,
      estimatedDuration: duration,
      render: {
        transition: preview.transition,
        withTitleCard: preview.withTitleCard,
        includeAudio: preview.includeAudio,
        voices: preview.voices,
        musicScenes: preview.musicScenes,
        ambienceScenes: preview.ambienceScenes,
      },
      message: "Full project preview ready with current dialogue, music, ambience, and transitions.",
    };

    await db.exportJob.update({
      where: { id: jobId },
      data: {
        status: "done",
        activeKey: null,
        progress: 100,
        step: "Full preview ready",
        result: JSON.stringify(payload),
        error: null,
        updatedAt: new Date(),
      },
    });

    // Retention is deliberately best-effort and runs only after the new preview
    // result is durable. A cleanup failure must never turn a valid reviewed cut
    // into a failed user job. The current URL is explicitly protected in
    // addition to the newest-count and age safety windows.
    const retention = await enforceProjectReviewCutRetention(job.projectId, {
      protectedUrls: [preview.previewVideoUrl],
    }).catch((error) => {
      console.warn(
        `[review-cut-retention] project=${job.projectId} cleanup skipped:`,
        error instanceof Error ? error.message : "unknown error",
      );
      return null;
    });
    if (retention && (retention.deletedFiles > 0 || retention.deletedJobs > 0)) {
      console.log(
        `[review-cut-retention] project=${job.projectId} deleted files=${retention.deletedFiles} jobs=${retention.deletedJobs}`,
      );
    }
  } catch (error) {
    console.error(`[full-preview-job] ${jobId} failed:`, error);
    await db.exportJob
      .update({
        where: { id: jobId },
        data: {
          status: "failed",
          activeKey: null,
          step: "Preview failed",
          error: friendlyPreviewError(error),
          updatedAt: new Date(),
        },
      })
      .catch(() => undefined);
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
}
