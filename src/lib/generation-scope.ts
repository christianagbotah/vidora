export const GENERATION_QUEUED_STALE_MS = 5 * 60_000;

export interface GenerationScopeScene {
  videoUrl: string | null;
  status: string;
  taskId: string | null;
  errorMessage: string | null;
  updatedAt: Date;
}

/**
 * Single source of truth for NEW billable provider work.
 *
 * A persisted provider task is never included here: those tasks belong to an
 * existing durable run and must be polled/reconciled rather than re-priced or
 * resubmitted. Generic failed scenes are also excluded until the user edits or
 * explicitly re-queues them.
 */
export function isSceneEligibleForNewGeneration(
  scene: GenerationScopeScene,
  nowMs = Date.now(),
): boolean {
  if (scene.videoUrl) return false;
  if (scene.status === "pending") return true;
  if (
    scene.status === "queued" &&
    nowMs - new Date(scene.updatedAt).getTime() > GENERATION_QUEUED_STALE_MS
  ) return true;
  if (scene.status === "generating" && !scene.taskId) return true;
  return scene.status === "failed" && Boolean(scene.errorMessage?.toLowerCase().includes("rate"));
}

export function hasActiveLegacyGeneration(
  scene: GenerationScopeScene,
  nowMs = Date.now(),
): boolean {
  if (scene.videoUrl) return false;
  if (scene.status === "generating" && Boolean(scene.taskId)) return true;
  return scene.status === "queued" &&
    nowMs - new Date(scene.updatedAt).getTime() <= GENERATION_QUEUED_STALE_MS;
}
