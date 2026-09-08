const FINAL_EXPORT_PREFIX = "final_";
const FINAL_EXPORT_EXTENSIONS = new Set(["mp4", "webm"]);
const EARLIEST_CURRENT_TIMESTAMP_MS = 1_500_000_000_000;

export interface FinalExportFileInfo {
  projectId: string;
  createdAtMs: number | null;
  extension: "mp4" | "webm";
  legacy: boolean;
}

/**
 * Parse generated final-export filenames.
 *
 * Current exporter output:
 *   final_<projectId>_<timestamp>.mp4
 *   final_<projectId>_<timestamp>.webm
 *
 * Legacy concatenate output:
 *   final_<projectId>.mp4
 *
 * Current timestamps are Date.now() millisecond values. Requiring a plausible
 * modern millisecond timestamp avoids misclassifying a legacy project id that
 * itself happens to end in an underscore followed by digits.
 */
export function finalExportFileInfo(relPath: string): FinalExportFileInfo | null {
  if (relPath.includes("/") || !relPath.startsWith(FINAL_EXPORT_PREFIX)) return null;

  const dot = relPath.lastIndexOf(".");
  if (dot <= FINAL_EXPORT_PREFIX.length) return null;
  const extension = relPath.slice(dot + 1).toLowerCase();
  if (!FINAL_EXPORT_EXTENSIONS.has(extension)) return null;

  const stem = relPath.slice(FINAL_EXPORT_PREFIX.length, dot);
  if (!stem) return null;

  const current = /^(.*)_(\d+)$/.exec(stem);
  if (current) {
    const projectId = current[1];
    const createdAtMs = Number(current[2]);
    if (
      /^[A-Za-z0-9_-]+$/.test(projectId) &&
      Number.isSafeInteger(createdAtMs) &&
      createdAtMs >= EARLIEST_CURRENT_TIMESTAMP_MS
    ) {
      return {
        projectId,
        createdAtMs,
        extension: extension as "mp4" | "webm",
        legacy: false,
      };
    }
  }

  if (!/^[A-Za-z0-9_-]+$/.test(stem)) return null;
  return {
    projectId: stem,
    createdAtMs: null,
    extension: extension as "mp4" | "webm",
    legacy: true,
  };
}
