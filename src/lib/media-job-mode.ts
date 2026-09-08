export type MediaJobMode = "preview" | "final";

/**
 * Parse ExportJob.params at trust boundaries. Only an explicit preview marker
 * is treated as preview; missing, malformed, or unknown modes fail closed to
 * final so they cannot bypass the reviewed-cut database guard.
 */
export function mediaJobMode(params: string | null): MediaJobMode {
  if (!params) return "final";
  try {
    const parsed = JSON.parse(params) as { mode?: unknown };
    return parsed?.mode === "preview" ? "preview" : "final";
  } catch {
    return "final";
  }
}

export function currentCutIsReviewed(project: {
  cutVersion: number;
  reviewedCutVersion: number | null;
}): boolean {
  return project.reviewedCutVersion === project.cutVersion;
}
