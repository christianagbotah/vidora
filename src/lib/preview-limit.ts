/**
 * Vidora — Free Preview Quota
 *
 * Free AI previews are an explicit customer-acquisition budget. Quota
 * consumption is serialized per user in Postgres so concurrent requests
 * cannot exceed the configured daily allowance.
 */

import { db } from "@/lib/db";
import { PREVIEW_LIMITS } from "@/lib/pricing";

export type PreviewKind = "storyboard" | "image";

export interface PreviewLimitResult {
  ok: boolean;
  remaining: number;
  limit: number;
  used: number;
  reason?: string;
}

function todayStr(timezone?: string): string {
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
 * Serialize preview quota mutations on the real User row.
 *
 * Do not use pg_advisory_xact_lock() through Prisma $queryRaw here: PostgreSQL
 * returns that function as type `void`, which Prisma cannot deserialize. A
 * row-level FOR UPDATE lock protects the exact quota owner, avoids advisory
 * hash collisions, and remains scoped to the surrounding transaction.
 */
async function lockPreviewUser(tx: any, userId: string): Promise<void> {
  const rows = await tx.$queryRaw`
    SELECT "id"
    FROM "User"
    WHERE "id" = ${userId}
    FOR UPDATE
  ` as Array<{ id: string }>;

  if (rows.length !== 1) {
    throw new Error("User not found");
  }
}

export async function consumePreviewQuota(
  userId: string,
  kind: PreviewKind
): Promise<PreviewLimitResult> {
  const today = todayStr();
  const limit =
    kind === "storyboard"
      ? PREVIEW_LIMITS.storyboardPerDay
      : PREVIEW_LIMITS.imagePerDay;
  const countField =
    kind === "storyboard" ? "previewStoryboardCount" : "previewImageCount";

  try {
    const result = await db.$transaction(async (tx) => {
      await lockPreviewUser(tx, userId);

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          previewDate: true,
          previewStoryboardCount: true,
          previewImageCount: true,
        },
      });
      if (!user) throw new Error("User not found");

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
    return {
      ok: false,
      remaining: 0,
      limit,
      used: 0,
      reason: err instanceof Error ? err.message : "Quota check failed",
    };
  }
}

export async function getPreviewUsage(
  userId: string
): Promise<{
  storyboard: { used: number; limit: number };
  image: { used: number; limit: number };
}> {
  const today = todayStr();
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      previewDate: true,
      previewStoryboardCount: true,
      previewImageCount: true,
    },
  });

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

export async function refundPreviewQuota(
  userId: string,
  kind: PreviewKind
): Promise<void> {
  const today = todayStr();
  const countField =
    kind === "storyboard" ? "previewStoryboardCount" : "previewImageCount";

  try {
    await db.$transaction(async (tx) => {
      await lockPreviewUser(tx, userId);
      await tx.user.updateMany({
        where: {
          id: userId,
          previewDate: today,
          [countField]: { gt: 0 },
        },
        data: { [countField]: { decrement: 1 } },
      });
    });
  } catch (err) {
    console.error(
      "Failed to refund preview quota:",
      err instanceof Error ? err.message : "unknown error"
    );
  }
}
