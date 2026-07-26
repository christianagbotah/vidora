/**
 * ───────────────────────────────────────────────────────────────────────────
 *  Vidora — Free Preview Rate Limiter
 * ───────────────────────────────────────────────────────────────────────────
 *
 *  Enforces per-user daily limits on free previews so the owner's Z.ai costs
 *  stay bounded. Counts reset at local midnight (tracked by previewDate).
 *
 *  Two preview types:
 *   - "storyboard"  → max 10/day (cheap, LLM-only)
 *   - "image"       → max 3/day  (costlier, real image generation)
 *
 *  This is the ONLY place that checks/increments preview counters. All preview
 *  API routes must go through here to keep limits consistent.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { db } from "@/lib/db";
import { PREVIEW_LIMITS } from "@/lib/pricing";

export type PreviewKind = "storyboard" | "image";

export interface PreviewLimitResult {
  ok: boolean;
  /** Remaining previews of this kind for today */
  remaining: number;
  /** Daily limit for this kind */
  limit: number;
  /** Used today */
  used: number;
  /** Reason if blocked */
  reason?: string;
}

function todayStr(timezone?: string): string {
  // Use the configured timezone (default Africa/Accra per app settings) so
  // "today" matches the user's local day. Falls back to UTC if TZ invalid.
  try {
    return new Date().toLocaleDateString("en-CA", {
      timeZone: timezone || "Africa/Accra",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Check whether the user may use another free preview of `kind`, and if so,
 * atomically increment their daily counter.
 *
 * If the user's previewDate doesn't match today, the window resets first.
 */
export async function consumePreviewQuota(
  userId: string,
  kind: PreviewKind
): Promise<PreviewLimitResult> {
  const today = todayStr();
  const limit =
    kind === "storyboard" ? PREVIEW_LIMITS.storyboardPerDay : PREVIEW_LIMITS.imagePerDay;
  const countField =
    kind === "storyboard" ? "previewStoryboardCount" : "previewImageCount";

  try {
    const result = await db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          previewDate: true,
          previewStoryboardCount: true,
          previewImageCount: true,
        },
      });

      if (!user) {
        throw new Error("User not found");
      }

      // Reset the daily window if it's a new day
      const needsReset = user.previewDate !== today;
      const currentUsed = needsReset ? 0 : user[countField];

      if (currentUsed >= limit) {
        return { blocked: true as const, used: currentUsed };
      }

      const newCount = currentUsed + 1;
      await tx.user.update({
        where: { id: userId },
        data: needsReset
          ? {
              previewDate: today,
              previewStoryboardCount: kind === "storyboard" ? 1 : 0,
              previewImageCount: kind === "image" ? 1 : 0,
            }
          : { [countField]: { increment: 1 } },
      });

      return { blocked: false as const, used: newCount };
    });

    if (result.blocked) {
      return {
        ok: false,
        remaining: 0,
        limit,
        used: result.used,
        reason: `Daily free preview limit reached (${limit}/day). Buy tokens to generate full videos, or try again tomorrow.`,
      };
    }

    return {
      ok: true,
      remaining: Math.max(0, limit - result.used),
      limit,
      used: result.used,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Quota check failed";
    return {
      ok: false,
      remaining: 0,
      limit,
      used: 0,
      reason: message,
    };
  }
}

/**
 * Read-only check of the user's current preview usage (no increment).
 * Used by the UI to show "3/3 previews used today" badges.
 */
export async function getPreviewUsage(
  userId: string
): Promise<{ storyboard: { used: number; limit: number }; image: { used: number; limit: number } }> {
  const today = todayStr();
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      previewDate: true,
      previewStoryboardCount: true,
      previewImageCount: true,
    },
  });

  // If the window is stale, treat counts as zero
  const stale = !user || user.previewDate !== today;
  return {
    storyboard: {
      used: stale ? 0 : user!.previewStoryboardCount,
      limit: PREVIEW_LIMITS.storyboardPerDay,
    },
    image: {
      used: stale ? 0 : user!.previewImageCount,
      limit: PREVIEW_LIMITS.imagePerDay,
    },
  };
}

/**
 * Refund a previously-consumed preview quota (decrement the daily counter).
 *
 * Call this when a preview generation fails due to a SERVER-SIDE error
 * (e.g., Z.ai is down, insufficient balance on the owner's account) so the
 * user isn't unfairly penalized for a failure that wasn't their fault.
 *
 * Does NOT refund on 4xx client errors (bad input) — those are the user's
 * responsibility and should still count against the quota to prevent abuse.
 *
 * Safe to call even if the window has rolled over (no-op in that case).
 */
export async function refundPreviewQuota(
  userId: string,
  kind: PreviewKind
): Promise<void> {
  const today = todayStr();
  const countField =
    kind === "storyboard" ? "previewStoryboardCount" : "previewImageCount";

  try {
    // Only decrement if we're still in the same daily window AND count > 0.
    // Using a conditional update prevents going negative.
    await db.user.updateMany({
      where: {
        id: userId,
        previewDate: today,
        [countField]: { gt: 0 },
      },
      data: { [countField]: { decrement: 1 } },
    });
  } catch (err) {
    // Non-fatal — a failed refund just means the user lost one quota slot,
    // which is acceptable compared to blocking the request flow.
    console.error("Failed to refund preview quota:", err);
  }
}
