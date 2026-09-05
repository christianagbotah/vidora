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

/**
 * Resume a held run that still has provider task IDs. This is safe because
 * polling an already-persisted task ID cannot create a duplicate provider
 * charge. Terminally failed task IDs may be cleared and resubmitted under the
 * same original Vidora token charge; in-flight task IDs are preserved.
 */
export function canRecoverHeldProviderRun(
  run: ReconciliationRunLike,
  allProjectScenes: ReconciliationSceneLike[]
): {
  safe: boolean;
  sceneIds: string[];
  queueSceneIds: string[];
  preserveTaskSceneIds: string[];
  reason?: string;
} {
  const empty = (reason: string, sceneIds: string[] = []) => ({
    safe: false,
    sceneIds,
    queueSceneIds: [],
    preserveTaskSceneIds: [],
    reason,
  });

  if (run.status !== "needs_reconciliation" || !run.activeKey) {
    return empty("run is not held for reconciliation");
  }
  if (run.refundTransactionId) {
    return empty("the original Vidora token charge was already refunded");
  }
  if (run.totalTokens > 0 && !run.chargeTransactionId) {
    return empty("charge state is incomplete");
  }

  const scope = scopedScenes(run, allProjectScenes);
  if (scope.reason) return empty(scope.reason, scope.sceneIds);

  const unfinished = scope.scoped.filter((scene) => !scene.videoUrl);
  if (unfinished.length === 0) return empty("run has no unfinished scenes", scope.sceneIds);

  // A submission with no persisted taskId is ambiguous. The explicit
  // reference-download path is handled separately before this function.
  if (unfinished.some((scene) => scene.status === "submitting" && !scene.taskId)) {
    return empty("provider submission state is ambiguous", scope.sceneIds);
  }
  if (unfinished.some((scene) => scene.status === "failed" && !scene.taskId)) {
    return empty("a failed scene has no persisted provider task", scope.sceneIds);
  }

  const preserveTaskSceneIds = unfinished
    .filter((scene) => Boolean(scene.taskId) && scene.status !== "failed")
    .map((scene) => scene.id);
  const terminalFailedSceneIds = unfinished
    .filter((scene) => Boolean(scene.taskId) && scene.status === "failed")
    .map((scene) => scene.id);
  const neverSubmittedSceneIds = unfinished
    .filter((scene) => !scene.taskId && (scene.status === "queued" || scene.status === "pending"))
    .map((scene) => scene.id);

  const classified = new Set([
    ...preserveTaskSceneIds,
    ...terminalFailedSceneIds,
    ...neverSubmittedSceneIds,
  ]);
  if (classified.size !== unfinished.length) {
    return empty("held run contains an unsupported scene state", scope.sceneIds);
  }
  if (preserveTaskSceneIds.length === 0 && terminalFailedSceneIds.length === 0) {
    return empty("no persisted provider task is available to recover", scope.sceneIds);
  }

  return {
    safe: true,
    sceneIds: scope.sceneIds,
    queueSceneIds: [...terminalFailedSceneIds, ...neverSubmittedSceneIds],
    preserveTaskSceneIds,
  };
}
