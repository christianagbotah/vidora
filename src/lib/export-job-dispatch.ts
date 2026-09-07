import { db } from "@/lib/db";
import { runFullPreviewJob } from "@/lib/full-preview-job";
import { runExportJob } from "@/app/api/export-video/route";

function jobMode(params: string | null): string {
  if (!params) return "final";
  try {
    const parsed = JSON.parse(params) as { mode?: unknown };
    return typeof parsed.mode === "string" ? parsed.mode : "final";
  } catch {
    return "final";
  }
}

export async function runQueuedMediaJob(jobId: string): Promise<void> {
  const job = await db.exportJob.findUnique({
    where: { id: jobId },
    select: { params: true },
  });
  if (!job) return;

  if (jobMode(job.params) === "preview") {
    await runFullPreviewJob(jobId);
    return;
  }

  await runExportJob(jobId);
}
