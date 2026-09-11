import { db } from "@/lib/db";
import { runFullPreviewJob } from "@/lib/full-preview-job";

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
 * The durable export worker now owns Full Preview rendering only.
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

  if (jobMode(job.params) !== "preview") {
    console.warn(`[export-worker] ignored non-preview job ${jobId}; final exports are browser-streamed`);
    return;
  }

  await runFullPreviewJob(jobId);
}
