const REVIEW_CUT_PREFIX = "preview_";
const REVIEW_CUT_SUFFIX = ".mp4";

export interface ReviewCutFileInfo {
  projectId: string;
  cutVersion: number | null;
  createdAtMs: number | null;
  legacy: boolean;
}

/**
 * Parse a private Full Preview filename.
 *
 * Current renderer output:
 *   preview_<projectId>_<cutVersion>_<timestamp>.mp4
 *
 * Legacy renderer output:
 *   preview_<projectId>.mp4
 *
 * Project ids may contain hyphens/underscores, so the current format is parsed
 * from the two numeric suffixes instead of splitting on the first underscore.
 */
export function reviewCutFileInfo(relPath: string): ReviewCutFileInfo | null {
  if (
    relPath.includes("/") ||
    !relPath.startsWith(REVIEW_CUT_PREFIX) ||
    !relPath.endsWith(REVIEW_CUT_SUFFIX)
  ) {
    return null;
  }

  const stem = relPath.slice(REVIEW_CUT_PREFIX.length, -REVIEW_CUT_SUFFIX.length);
  if (!stem) return null;

  const current = /^(.*)_(\d+)_(\d+)$/.exec(stem);
  const projectId = current?.[1] || stem;
  if (!/^[A-Za-z0-9_-]+$/.test(projectId)) return null;

  if (!current) {
    return {
      projectId,
      cutVersion: null,
      createdAtMs: null,
      legacy: true,
    };
  }

  const cutVersion = Number(current[2]);
  const createdAtMs = Number(current[3]);
  if (!Number.isSafeInteger(cutVersion) || cutVersion < 0) return null;
  if (!Number.isSafeInteger(createdAtMs) || createdAtMs <= 0) return null;

  return {
    projectId,
    cutVersion,
    createdAtMs,
    legacy: false,
  };
}

/** Return the project id encoded in a private Full Preview filename. */
export function reviewCutProjectId(relPath: string): string | null {
  return reviewCutFileInfo(relPath)?.projectId ?? null;
}
