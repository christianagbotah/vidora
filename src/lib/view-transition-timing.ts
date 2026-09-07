export const VIEW_TRANSITION_MIN_MS = 800;
export const VIEW_TRANSITION_MAX_MS = 4000;

export interface ViewTransitionTiming {
  elapsedMs: number;
  readyDelayMs: number;
  hardCapDelayMs: number;
}

/**
 * Resolve transition timing from one monotonic start timestamp.
 *
 * `readyDelayMs` keeps successful transitions visible for the configured minimum.
 * `hardCapDelayMs` is always measured from the original loading event, so a
 * missing `vidora:view-ready` signal can never leave the overlay up forever.
 */
export function resolveViewTransitionTiming(
  startedAtMs: number,
  nowMs: number,
  minMs = VIEW_TRANSITION_MIN_MS,
  maxMs = VIEW_TRANSITION_MAX_MS,
): ViewTransitionTiming {
  const safeStartedAt = Number.isFinite(startedAtMs) ? startedAtMs : 0;
  const safeNow = Number.isFinite(nowMs) ? nowMs : safeStartedAt;
  const safeMin = Number.isFinite(minMs) ? Math.max(0, minMs) : VIEW_TRANSITION_MIN_MS;
  const safeMax = Number.isFinite(maxMs)
    ? Math.max(safeMin, maxMs)
    : Math.max(safeMin, VIEW_TRANSITION_MAX_MS);
  const elapsedMs = Math.max(0, safeNow - safeStartedAt);

  return {
    elapsedMs,
    readyDelayMs: Math.max(0, safeMin - elapsedMs),
    hardCapDelayMs: Math.max(0, safeMax - elapsedMs),
  };
}
