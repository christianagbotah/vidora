import { readdir, unlink } from "fs/promises";
import { db } from "@/lib/db";
import { generatedFilePath, generatedStoreDir } from "@/lib/generated-store";
import { reviewCutFileInfo } from "@/lib/review-cut-media";

export const REVIEW_CUT_MIN_KEEP = 5;
export const REVIEW_CUT_MIN_AGE_MS = 72 * 60 * 60 * 1000;

interface ReviewCutRetentionOptions {
  nowMs?: number;
  protectedUrls?: string[];
}

export interface ReviewCutRetentionResult {
  deletedFiles: number;
  deletedJobs: number;
}

function previewMode(params: string | null): boolean {
  if (!params) return false;
  try {
    const parsed = JSON.parse(params) as { mode?: unknown };
    return parsed?.mode === "preview";
  } catch {
    return false;
  }
}

function previewResultFileName(result: string | null): string | null {
  if (!result) return null;
  try {
    const parsed = JSON.parse(result) as { previewVideoUrl?: unknown };
    if (typeof parsed?.previewVideoUrl !== "string") return null;
    const prefix = "/generated/";
    if (!parsed.previewVideoUrl.startsWith(prefix)) return null;
    const rel = parsed.previewVideoUrl.slice(prefix.length);
    return rel && !rel.includes("/") ? rel : null;
  } catch {
    return null;
  }
}

function protectedFileName(url: string): string | null {
  const prefix = "/generated/";
  if (!url.startsWith(prefix)) return null;
  const rel = url.slice(prefix.length);
  return rel && !rel.includes("/") ? rel : null;
}

/**
 * Decide which current-format Full Preview files can be removed safely.
 *
 * Safety policy:
 * - legacy preview_<project>.mp4 files are never auto-deleted;
 * - always keep the newest five previews for a project;
 * - always keep every preview younger than 72 hours;
 * - always keep explicitly protected URLs (including the just-finished job).
 *
 * This creates a generous browser/job grace window while putting a hard bound
 * on long-term per-project accumulation after users repeatedly rebuild previews.
 */
export function reviewCutFilesToPrune(
  fileNames: string[],
  projectId: string,
  options: ReviewCutRetentionOptions = {},
): string[] {
  const nowMs = options.nowMs ?? Date.now();
  const protectedNames = new Set(
    (options.protectedUrls ?? [])
      .map(protectedFileName)
      .filter((value): value is string => Boolean(value)),
  );

  const candidates = fileNames
    .map((fileName) => ({ fileName, info: reviewCutFileInfo(fileName) }))
    .filter((entry) =>
      entry.info &&
      !entry.info.legacy &&
      entry.info.projectId === projectId &&
      entry.info.createdAtMs !== null,
    )
    .sort((a, b) => (b.info!.createdAtMs! - a.info!.createdAtMs!));

  const newest = new Set(
    candidates.slice(0, REVIEW_CUT_MIN_KEEP).map((entry) => entry.fileName),
  );

  return candidates
    .filter((entry) => {
      if (protectedNames.has(entry.fileName) || newest.has(entry.fileName)) return false;
      const createdAtMs = entry.info!.createdAtMs!;
      // Future timestamps fail closed and are retained.
      if (createdAtMs > nowMs) return false;
      return nowMs - createdAtMs >= REVIEW_CUT_MIN_AGE_MS;
    })
    .map((entry) => entry.fileName);
}

/**
 * Enforce bounded Full Preview retention for one project.
 *
 * Matching completed preview ExportJob rows are removed before their media so
 * Vidora never intentionally leaves a durable job result pointing at a file it
 * has just expired. Files that have no matching job row are treated as orphans
 * and can still be cleaned once they age beyond the same safety policy.
 */
export async function enforceProjectReviewCutRetention(
  projectId: string,
  options: ReviewCutRetentionOptions = {},
): Promise<ReviewCutRetentionResult> {
  let fileNames: string[];
  try {
    const entries = await readdir(generatedStoreDir(), { withFileTypes: true });
    fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";
    if (code === "ENOENT") return { deletedFiles: 0, deletedJobs: 0 };
    throw error;
  }

  const filesToDelete = reviewCutFilesToPrune(fileNames, projectId, options);
  if (filesToDelete.length === 0) return { deletedFiles: 0, deletedJobs: 0 };

  const deleteSet = new Set(filesToDelete);
  const completedJobs = await db.exportJob.findMany({
    where: { projectId, status: "done" },
    select: { id: true, params: true, result: true },
  });
  const jobIds = completedJobs
    .filter((job) => previewMode(job.params))
    .filter((job) => {
      const fileName = previewResultFileName(job.result);
      return fileName ? deleteSet.has(fileName) : false;
    })
    .map((job) => job.id);

  if (jobIds.length > 0) {
    await db.exportJob.deleteMany({ where: { id: { in: jobIds } } });
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
          `[review-cut-retention] project=${projectId} could not delete ${fileName}:`,
          error instanceof Error ? error.message : "unknown error",
        );
      }
    }
  }

  return { deletedFiles, deletedJobs: jobIds.length };
}
