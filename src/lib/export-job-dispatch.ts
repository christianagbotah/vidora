import { db } from "@/lib/db";
import { runFullPreviewJob } from "@/lib/full-preview-job";
import { runPhotoSlideshowJob } from "@/lib/photo-slideshow-render";

function jobMode(params: string | null): string {
  if (!params) return "final";
  try {
    const parsed = JSON.parse(params) as { mode?: unknown };
    return typeof parsed.mode === "string" ? parsed.mode : "final";
  } catch {
    return "final";
  }
}

/**
 * The durable export worker owns Full Preview and provider-free Photo Studio slideshow rendering.
 *
 * Final exports are intentionally excluded: their ffmpeg stdout is streamed
 * directly to the authenticated browser download response, so allowing the
 * background worker to render a final job would re-introduce persistent final
 * files and race the one-time download endpoint.
 */
export async function runQueuedMediaJob(jobId: string): Promise<void> {
  const job = await db.exportJob.findUnique({
    where: { id: jobId },
    select: { params: true },
  });
  if (!job) return;

  const mode = jobMode(job.params);
  if (mode === "preview") {
    await runFullPreviewJob(jobId);
    return;
  }
  if (mode === "photo_slideshow") {
    await runPhotoSlideshowJob(jobId);
    return;
  }

  console.warn(`[export-worker] ignored unsupported background media job ${jobId}; final exports are browser-streamed`);
}
