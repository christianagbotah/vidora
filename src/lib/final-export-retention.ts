import { readdir, unlink } from "fs/promises";
import { db } from "@/lib/db";
import { finalExportFileInfo } from "@/lib/final-export-media";
import { generatedFilePath, generatedStoreDir } from "@/lib/generated-store";
import { mediaJobMode } from "@/lib/media-job-mode";

export const FINAL_EXPORT_MIN_KEEP = 10;
export const FINAL_EXPORT_MIN_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface FinalExportRetentionOptions {
  nowMs?: number;
  protectedUrls?: string[];
}

export interface FinalExportRetentionResult {
  deletedFiles: number;
  expiredJobs: number;
}

function generatedFileName(url: string | null | undefined): string | null {
  if (!url) return null;
  const prefix = "/generated/";
  if (!url.startsWith(prefix)) return null;
  const rel = url.slice(prefix.length);
  return rel && !rel.includes("/") ? rel : null;
}

function finalResultFileName(result: string | null): string | null {
  if (!result) return null;
  try {
    const parsed = JSON.parse(result) as { finalVideoUrl?: unknown };
    return typeof parsed?.finalVideoUrl === "string"
      ? generatedFileName(parsed.finalVideoUrl)
      : null;
  } catch {
    return null;
  }
}

function expireFinalResult(result: string, nowMs: number): string | null {
  try {
    const parsed = JSON.parse(result) as Record<string, unknown>;
    if (typeof parsed.finalVideoUrl !== "string") return null;
    parsed.finalVideoUrl = null;
    parsed.message =
      "This archived export file has expired under Vidora's storage retention policy. Export the project again to create a fresh download.";
    parsed.expired = true;
    parsed.expiredAt = new Date(nowMs).toISOString();
    return JSON.stringify(parsed);
  } catch {
    return null;
  }
}

/**
 * Select current-format final exports that are old enough to expire.
 *
 * Final exports are more valuable than transient Full Previews, so their
 * safety window is intentionally larger:
 * - legacy final_<project>.mp4/webm files are never auto-deleted;
 * - always keep the newest ten current-format exports per project;
 * - always keep every export younger than 30 days;
 * - always keep explicitly protected URLs, especially VideoProject.finalVideoUrl.
 */
export function finalExportFilesToPrune(
  fileNames: string[],
  projectId: string,
  options: FinalExportRetentionOptions = {},
): string[] {
  const nowMs = options.nowMs ?? Date.now();
  const protectedNames = new Set(
    (options.protectedUrls ?? [])
      .map(generatedFileName)
      .filter((value): value is string => Boolean(value)),
  );

  const candidates = fileNames
    .map((fileName) => ({ fileName, info: finalExportFileInfo(fileName) }))
    .filter((entry) =>
      entry.info &&
      !entry.info.legacy &&
      entry.info.projectId === projectId &&
      entry.info.createdAtMs !== null,
    )
    .sort((a, b) => b.info!.createdAtMs! - a.info!.createdAtMs!);

  const newest = new Set(
    candidates.slice(0, FINAL_EXPORT_MIN_KEEP).map((entry) => entry.fileName),
  );

  return candidates
    .filter((entry) => {
      if (protectedNames.has(entry.fileName) || newest.has(entry.fileName)) return false;
      const createdAtMs = entry.info!.createdAtMs!;
      if (createdAtMs > nowMs) return false;
      return nowMs - createdAtMs >= FINAL_EXPORT_MIN_AGE_MS;
    })
    .map((entry) => entry.fileName);
}

/**
 * Enforce bounded final-export retention for one project.
 *
 * Unlike transient preview history, completed final ExportJob rows are kept as
 * an audit/history record. Before an old media file is removed, matching job
 * results are rewritten to remove the stale download URL and clearly mark the
 * archived file as expired. Orphan files with no matching job can still be
 * removed under the same age/count policy.
 */
export async function enforceProjectFinalExportRetention(
  projectId: string,
  options: FinalExportRetentionOptions = {},
): Promise<FinalExportRetentionResult> {
  const nowMs = options.nowMs ?? Date.now();
  const project = await db.videoProject.findUnique({
    where: { id: projectId },
    select: { finalVideoUrl: true },
  });
  const protectedUrls = [
    ...(options.protectedUrls ?? []),
    ...(project?.finalVideoUrl ? [project.finalVideoUrl] : []),
  ];

  let fileNames: string[];
  try {
    const entries = await readdir(generatedStoreDir(), { withFileTypes: true });
    fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";
    if (code === "ENOENT") return { deletedFiles: 0, expiredJobs: 0 };
    throw error;
  }

  const filesToDelete = finalExportFilesToPrune(fileNames, projectId, {
    nowMs,
    protectedUrls,
  });
  if (filesToDelete.length === 0) return { deletedFiles: 0, expiredJobs: 0 };

  const deleteSet = new Set(filesToDelete);
  const completedJobs = await db.exportJob.findMany({
    where: { projectId, status: "done" },
    select: { id: true, params: true, result: true },
  });

  let expiredJobs = 0;
  for (const job of completedJobs) {
    if (mediaJobMode(job.params) !== "final" || !job.result) continue;
    const fileName = finalResultFileName(job.result);
    if (!fileName || !deleteSet.has(fileName)) continue;
    const expiredResult = expireFinalResult(job.result, nowMs);
    if (!expiredResult) continue;
    await db.exportJob.update({
      where: { id: job.id },
      data: { result: expiredResult, updatedAt: new Date(nowMs) },
    });
    expiredJobs++;
  }

  let deletedFiles = 0;
  for (const fileName of filesToDelete) {
    try {
      await unlink(generatedFilePath(fileName));
      deletedFiles++;
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code ?? "")
          : "";
      if (code !== "ENOENT") {
        console.warn(
          `[final-export-retention] project=${projectId} could not delete ${fileName}:`,
          error instanceof Error ? error.message : "unknown error",
        );
      }
    }
  }

  return { deletedFiles, expiredJobs };
}
