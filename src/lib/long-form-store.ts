import crypto from "crypto";
import { db } from "@/lib/db";
import type { LongFormPlan, NormalizedLongFormRequest } from "@/lib/long-form-planner";

interface ProductionRow {
  id: string;
  userId: string;
}

export interface PersistedLongFormPlan {
  productionId: string;
  seasonCount: number;
  episodeCount: number;
  alreadyPersisted: boolean;
}

/**
 * Persist a validated long-form plan as one atomic hierarchy. The unique
 * planningReferenceId makes post-provider persistence retryable without ever
 * rerunning or double-writing the paid planning call.
 */
export async function persistLongFormPlan(opts: {
  userId: string;
  planningReferenceId: string;
  spec: NormalizedLongFormRequest;
  plan: LongFormPlan;
}): Promise<PersistedLongFormPlan> {
  const episodeCount = opts.plan.seasons.reduce((sum, season) => sum + season.episodes.length, 0);

  return db.$transaction(async (tx) => {
    const productionId = crypto.randomUUID();
    const inserted = await tx.$queryRaw<ProductionRow[]>`
      INSERT INTO "LongFormProduction" (
        "id", "userId", "format", "title", "source", "status", "storyBible",
        "totalTargetMinutes", "planningReferenceId", "createdAt", "updatedAt"
      ) VALUES (
        ${productionId}, ${opts.userId}, ${opts.spec.format}, ${opts.plan.storyBible.title},
        ${opts.spec.source}, 'planned', ${JSON.stringify(opts.plan.storyBible)},
        ${opts.spec.totalTargetMinutes}, ${opts.planningReferenceId}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("planningReferenceId") DO NOTHING
      RETURNING "id", "userId"
    `;

    if (!inserted[0]) {
      const existing = await tx.$queryRaw<ProductionRow[]>`
        SELECT "id", "userId"
        FROM "LongFormProduction"
        WHERE "planningReferenceId" = ${opts.planningReferenceId}
        LIMIT 1
      `;
      if (!existing[0]) {
        throw new Error("Long-form persistence conflict could not be reconciled");
      }
      if (existing[0].userId !== opts.userId) {
        throw new Error("Long-form planning reference belongs to another user");
      }
      return {
        productionId: existing[0].id,
        seasonCount: opts.plan.seasons.length,
        episodeCount,
        alreadyPersisted: true,
      };
    }

    for (const season of opts.plan.seasons) {
      const seasonId = crypto.randomUUID();
      await tx.$executeRaw`
        INSERT INTO "LongFormSeason" (
          "id", "productionId", "seasonNumber", "title", "arc", "createdAt", "updatedAt"
        ) VALUES (
          ${seasonId}, ${productionId}, ${season.seasonNumber}, ${season.title}, ${season.arc},
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `;

      for (const episode of season.episodes) {
        await tx.$executeRaw`
          INSERT INTO "LongFormEpisode" (
            "id", "seasonId", "episodeNumber", "title", "logline", "targetMinutes",
            "openingHook", "emotionalArc", "actBeats", "payoffOrCliffhanger",
            "status", "expansionVersion", "createdAt", "updatedAt"
          ) VALUES (
            ${crypto.randomUUID()}, ${seasonId}, ${episode.episodeNumber}, ${episode.title},
            ${episode.logline}, ${episode.targetMinutes}, ${episode.openingHook},
            ${episode.emotionalArc}, ${JSON.stringify(episode.actBeats)},
            ${episode.payoffOrCliffhanger}, 'planned', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
        `;
      }
    }

    return {
      productionId,
      seasonCount: opts.plan.seasons.length,
      episodeCount,
      alreadyPersisted: false,
    };
  });
}

export async function getLongFormProductionForUser(opts: {
  productionId: string;
  userId: string;
}): Promise<{
  id: string;
  format: string;
  title: string;
  status: string;
  storyBible: string;
  totalTargetMinutes: number;
} | null> {
  const rows = await db.$queryRaw<Array<{
    id: string;
    format: string;
    title: string;
    status: string;
    storyBible: string;
    totalTargetMinutes: number;
  }>>`
    SELECT "id", "format", "title", "status", "storyBible", "totalTargetMinutes"
    FROM "LongFormProduction"
    WHERE "id" = ${opts.productionId} AND "userId" = ${opts.userId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}
