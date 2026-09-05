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

function scopedScenes(
  run: ReconciliationRunLike,
  allProjectScenes: ReconciliationSceneLike[]
): { sceneIds: string[]; scoped: ReconciliationSceneLike[]; reason?: string } {
  const sceneIds = generationRunSceneIds(run);
  if (sceneIds.length === 0) return { sceneIds, scoped: [], reason: "run scene scope is missing" };

  const wanted = new Set(sceneIds);
  const scoped = allProjectScenes.filter((scene) => wanted.has(scene.id));
  if (scoped.length !== sceneIds.length) {
    return { sceneIds, scoped, reason: "run scene scope no longer matches project" };
  }
  return { sceneIds, scoped };
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

  const scope = scopedScenes(run, allProjectScenes);
  if (scope.reason) return { safe: false, sceneIds: scope.sceneIds, reason: scope.reason };
  if (scope.scoped.some((scene) => Boolean(scene.taskId) || Boolean(scene.videoUrl))) {
    return { safe: false, sceneIds: scope.sceneIds, reason: "provider work may already exist" };
  }
  if (scope.scoped.some((scene) => scene.status === "submitting" || scene.status === "generating")) {
    return { safe: false, sceneIds: scope.sceneIds, reason: "provider submission state is ambiguous" };
  }

  const failed = scope.scoped.filter((scene) => scene.status === "failed" || Boolean(scene.errorMessage));
  if (failed.length === 0 || failed.some((scene) => !isExplicitReferenceDownloadFailure(scene.errorMessage))) {
    return { safe: false, sceneIds: scope.sceneIds, reason: "failure is not an explicit reference-image download rejection" };
  }

  return { safe: true, sceneIds: scope.sceneIds };
}

/**
 * A provider task that has a persisted taskId AND a persisted terminal
 * `failed` scene state is no longer ambiguous: Vidora received a definitive
 * failed result while polling that exact task. We can safely reactivate the
 * SAME charged GenerationRun and retry only its unfinished scope without
 * deducting Vidora tokens a second time.
 *
 * Unsubmitted queued/pending scenes in the same batch are also safe because
 * they have no taskId. Any submitting/generating scene, or any taskId attached
 * to a non-failed unfinished scene, keeps the run fail-closed.
 */
export function canRetryTerminalProviderFailure(
  run: ReconciliationRunLike,
  allProjectScenes: ReconciliationSceneLike[]
): { safe: boolean; sceneIds: string[]; retrySceneIds: string[]; reason?: string } {
  if (run.status !== "needs_reconciliation" || !run.activeKey) {
    return { safe: false, sceneIds: [], retrySceneIds: [], reason: "run is not held for reconciliation" };
  }
  if (run.refundTransactionId) {
    return { safe: false, sceneIds: [], retrySceneIds: [], reason: "the original Vidora token charge was already refunded" };
  }
  if (run.totalTokens > 0 && !run.chargeTransactionId) {
    return { safe: false, sceneIds: [], retrySceneIds: [], reason: "charge state is incomplete" };
  }

  const scope = scopedScenes(run, allProjectScenes);
  if (scope.reason) {
    return { safe: false, sceneIds: scope.sceneIds, retrySceneIds: [], reason: scope.reason };
  }

  const unfinished = scope.scoped.filter((scene) => !scene.videoUrl);
  if (unfinished.length === 0) {
    return { safe: false, sceneIds: scope.sceneIds, retrySceneIds: [], reason: "run has no unfinished scenes" };
  }
  if (unfinished.some((scene) => scene.status === "submitting" || scene.status === "generating")) {
    return { safe: false, sceneIds: scope.sceneIds, retrySceneIds: [], reason: "provider submission state is ambiguous" };
  }
  if (unfinished.some((scene) => Boolean(scene.taskId) && scene.status !== "failed")) {
    return { safe: false, sceneIds: scope.sceneIds, retrySceneIds: [], reason: "a provider task is not terminally failed" };
  }

  const terminalFailures = unfinished.filter((scene) => Boolean(scene.taskId) && scene.status === "failed");
  if (terminalFailures.length === 0) {
    return { safe: false, sceneIds: scope.sceneIds, retrySceneIds: [], reason: "no definitive failed provider task was recorded" };
  }

  return {
    safe: true,
    sceneIds: scope.sceneIds,
    retrySceneIds: unfinished.map((scene) => scene.id),
  };
}
