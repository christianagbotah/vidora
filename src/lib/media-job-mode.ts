export type MediaJobMode = "preview" | "photo_slideshow" | "final";

/**
 * Parse ExportJob.params at trust boundaries. Only explicit pre-review modes
 * are recognized; missing, malformed, or unknown modes fail closed to final so
 * they cannot bypass the reviewed-cut database guard.
 */
export function mediaJobMode(params: string | null): MediaJobMode {
  if (!params) return "final";
  try {
    const parsed = JSON.parse(params) as { mode?: unknown };
    if (parsed?.mode === "preview") return "preview";
    if (parsed?.mode === "photo_slideshow") return "photo_slideshow";
    return "final";
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
