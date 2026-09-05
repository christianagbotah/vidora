export type ReconciliationRunLike = {
  status: string;
  activeKey: string | null;
  totalTokens: number;
  chargeTransactionId: string | null;
  refundTransactionId: string | null;
  sceneIds: string;
  targetSceneId: string | null;
};

export type ReconciliationSceneLike = {
  id: string;
  status: string;
  taskId: string | null;
  videoUrl: string | null;
  errorMessage: string | null;
};

export function generationRunSceneIds(run: Pick<ReconciliationRunLike, "sceneIds" | "targetSceneId">): string[] {
  try {
    const parsed: unknown = JSON.parse(run.sceneIds || "[]");
    if (Array.isArray(parsed)) {
      const ids = parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
      if (ids.length > 0) return [...new Set(ids)];
    }
  } catch {
    // Fall back to the legacy single-scene scope below.
  }
  return run.targetSceneId ? [run.targetSceneId] : [];
}

export function isExplicitReferenceDownloadFailure(message: string | null | undefined): boolean {
  if (!message) return false;
  return /image download fail|failed to download image|image.*download.*fail|could not download this scene['’]s reference image/i.test(message);
}

/**
 * Auto-reconciliation is intentionally narrow. A provider/network ambiguity
 * must keep its active hold so Vidora never submits a duplicate paid task.
 * We only release a run when:
 *  - it is already in needs_reconciliation,
 *  - its exact scene scope can be reconstructed,
 *  - NO scoped scene ever received a provider taskId/video,
 *  - no scoped scene remains in `submitting`/`generating`, and
 *  - every failed scene carries the explicit reference-image download error.
 */
export function canAutoReconcileReferenceDownloadFailure(
  run: ReconciliationRunLike,
  allProjectScenes: ReconciliationSceneLike[]
): { safe: boolean; sceneIds: string[]; reason?: string } {
  if (run.status !== "needs_reconciliation" || !run.activeKey) {
    return { safe: false, sceneIds: [], reason: "run is not held for reconciliation" };
  }
  if (run.totalTokens < 0 || (run.totalTokens > 0 && !run.chargeTransactionId && !run.refundTransactionId)) {
    return { safe: false, sceneIds: [], reason: "charge state is incomplete" };
  }

  const sceneIds = generationRunSceneIds(run);
  if (sceneIds.length === 0) {
    return { safe: false, sceneIds, reason: "run scene scope is missing" };
  }

  const wanted = new Set(sceneIds);
  const scoped = allProjectScenes.filter((scene) => wanted.has(scene.id));
  if (scoped.length !== sceneIds.length) {
    return { safe: false, sceneIds, reason: "run scene scope no longer matches project" };
  }
  if (scoped.some((scene) => Boolean(scene.taskId) || Boolean(scene.videoUrl))) {
    return { safe: false, sceneIds, reason: "provider work may already exist" };
  }
  if (scoped.some((scene) => scene.status === "submitting" || scene.status === "generating")) {
    return { safe: false, sceneIds, reason: "provider submission state is ambiguous" };
  }

  const failed = scoped.filter((scene) => scene.status === "failed" || Boolean(scene.errorMessage));
  if (failed.length === 0 || failed.some((scene) => !isExplicitReferenceDownloadFailure(scene.errorMessage))) {
    return { safe: false, sceneIds, reason: "failure is not an explicit reference-image download rejection" };
  }

  return { safe: true, sceneIds };
}
