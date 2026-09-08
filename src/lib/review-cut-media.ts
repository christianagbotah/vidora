const REVIEW_CUT_PREFIX = "preview_";
const REVIEW_CUT_SUFFIX = ".mp4";

/**
 * Return the project id encoded in a private Full Preview filename.
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
export function reviewCutProjectId(relPath: string): string | null {
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

  return /^[A-Za-z0-9_-]+$/.test(projectId) ? projectId : null;
}
