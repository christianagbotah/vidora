import crypto from "crypto";
import { db } from "@/lib/db";
import type {
  LongFormEpisodePlan,
  LongFormPlan,
  LongFormStoryBible,
  NormalizedLongFormRequest,
} from "@/lib/long-form-planner";

interface ProductionRow {
  id: string;
  userId: string;
}

interface ProductionDetailRow {
  id: string;
  format: string;
  title: string;
  status: string;
  storyBible: string;
  totalTargetMinutes: number;
  createdAt: Date;
  updatedAt: Date;
}

interface HierarchyRow {
  seasonId: string;
  seasonNumber: number;
  seasonTitle: string;
  seasonArc: string;
  episodeId: string | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
  logline: string | null;
  targetMinutes: number | null;
  openingHook: string | null;
  emotionalArc: string | null;
  actBeats: string | null;
  payoffOrCliffhanger: string | null;
  episodeStatus: string | null;
  expansionVersion: number | null;
}

export interface PersistedLongFormPlan {
  productionId: string;
  seasonCount: number;
  episodeCount: number;
  alreadyPersisted: boolean;
}

export interface LongFormEpisodeRecord extends LongFormEpisodePlan {
  id: string;
  status: string;
  expansionVersion: number;
}

export interface LongFormSeasonRecord {
  id: string;
  seasonNumber: number;
  title: string;
  arc: string;
  episodes: LongFormEpisodeRecord[];
}

export interface LongFormProductionRecord {
  id: string;
  format: string;
  title: string;
  status: string;
  storyBible: LongFormStoryBible;
  totalTargetMinutes: number;
  createdAt: string;
  updatedAt: string;
  seasons: LongFormSeasonRecord[];
}

export interface LongFormEpisodeContext {
  productionId: string;
  productionTitle: string;
  format: string;
  storyBible: LongFormStoryBible;
  season: {
    id: string;
    seasonNumber: number;
    title: string;
    arc: string;
  };
  episode: LongFormEpisodeRecord;
}

function parseStoryBible(raw: string): LongFormStoryBible {
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Stored long-form story bible is corrupted");
  }
  return value as LongFormStoryBible;
}

function parseActBeats(raw: string | null): string[] {
  if (!raw) return [];
  const value = JSON.parse(raw) as unknown;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("Stored long-form episode beats are corrupted");
  }
  return value;
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
}): Promise<LongFormProductionRecord | null> {
  const productions = await db.$queryRaw<ProductionDetailRow[]>`
    SELECT "id", "format", "title", "status", "storyBible", "totalTargetMinutes", "createdAt", "updatedAt"
    FROM "LongFormProduction"
    WHERE "id" = ${opts.productionId} AND "userId" = ${opts.userId}
    LIMIT 1
  `;
  const production = productions[0];
  if (!production) return null;

  const hierarchy = await db.$queryRaw<HierarchyRow[]>`
    SELECT
      s."id" AS "seasonId",
      s."seasonNumber" AS "seasonNumber",
      s."title" AS "seasonTitle",
      s."arc" AS "seasonArc",
      e."id" AS "episodeId",
      e."episodeNumber" AS "episodeNumber",
      e."title" AS "episodeTitle",
      e."logline" AS "logline",
      e."targetMinutes" AS "targetMinutes",
      e."openingHook" AS "openingHook",
      e."emotionalArc" AS "emotionalArc",
      e."actBeats" AS "actBeats",
      e."payoffOrCliffhanger" AS "payoffOrCliffhanger",
      e."status" AS "episodeStatus",
      e."expansionVersion" AS "expansionVersion"
    FROM "LongFormSeason" s
    LEFT JOIN "LongFormEpisode" e ON e."seasonId" = s."id"
    WHERE s."productionId" = ${opts.productionId}
    ORDER BY s."seasonNumber" ASC, e."episodeNumber" ASC
  `;

  const seasons = new Map<string, LongFormSeasonRecord>();
  for (const row of hierarchy) {
    let season = seasons.get(row.seasonId);
    if (!season) {
      season = {
        id: row.seasonId,
        seasonNumber: row.seasonNumber,
        title: row.seasonTitle,
        arc: row.seasonArc,
        episodes: [],
      };
      seasons.set(row.seasonId, season);
    }
    if (row.episodeId && row.episodeNumber !== null) {
      season.episodes.push({
        id: row.episodeId,
        episodeNumber: row.episodeNumber,
        title: row.episodeTitle || `Episode ${row.episodeNumber}`,
        logline: row.logline || "",
        targetMinutes: row.targetMinutes || 1,
        openingHook: row.openingHook || "",
        emotionalArc: row.emotionalArc || "",
        actBeats: parseActBeats(row.actBeats),
        payoffOrCliffhanger: row.payoffOrCliffhanger || "",
        status: row.episodeStatus || "planned",
        expansionVersion: row.expansionVersion || 0,
      });
    }
  }

  return {
    id: production.id,
    format: production.format,
    title: production.title,
    status: production.status,
    storyBible: parseStoryBible(production.storyBible),
    totalTargetMinutes: Number(production.totalTargetMinutes),
    createdAt: new Date(production.createdAt).toISOString(),
    updatedAt: new Date(production.updatedAt).toISOString(),
    seasons: [...seasons.values()],
  };
}

export async function getLongFormEpisodeContextForUser(opts: {
  episodeId: string;
  userId: string;
}): Promise<LongFormEpisodeContext | null> {
  const rows = await db.$queryRaw<Array<{
    productionId: string;
    productionTitle: string;
    format: string;
    storyBible: string;
    seasonId: string;
    seasonNumber: number;
    seasonTitle: string;
    seasonArc: string;
    episodeId: string;
    episodeNumber: number;
    episodeTitle: string;
    logline: string;
    targetMinutes: number;
    openingHook: string;
    emotionalArc: string;
    actBeats: string;
    payoffOrCliffhanger: string;
    episodeStatus: string;
    expansionVersion: number;
  }>>`
    SELECT
      p."id" AS "productionId",
      p."title" AS "productionTitle",
      p."format" AS "format",
      p."storyBible" AS "storyBible",
      s."id" AS "seasonId",
      s."seasonNumber" AS "seasonNumber",
      s."title" AS "seasonTitle",
      s."arc" AS "seasonArc",
      e."id" AS "episodeId",
      e."episodeNumber" AS "episodeNumber",
      e."title" AS "episodeTitle",
      e."logline" AS "logline",
      e."targetMinutes" AS "targetMinutes",
      e."openingHook" AS "openingHook",
      e."emotionalArc" AS "emotionalArc",
      e."actBeats" AS "actBeats",
      e."payoffOrCliffhanger" AS "payoffOrCliffhanger",
      e."status" AS "episodeStatus",
      e."expansionVersion" AS "expansionVersion"
    FROM "LongFormEpisode" e
    INNER JOIN "LongFormSeason" s ON s."id" = e."seasonId"
    INNER JOIN "LongFormProduction" p ON p."id" = s."productionId"
    WHERE e."id" = ${opts.episodeId} AND p."userId" = ${opts.userId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;

  return {
    productionId: row.productionId,
    productionTitle: row.productionTitle,
    format: row.format,
    storyBible: parseStoryBible(row.storyBible),
    season: {
      id: row.seasonId,
      seasonNumber: row.seasonNumber,
      title: row.seasonTitle,
      arc: row.seasonArc,
    },
    episode: {
      id: row.episodeId,
      episodeNumber: row.episodeNumber,
      title: row.episodeTitle,
      logline: row.logline,
      targetMinutes: row.targetMinutes,
      openingHook: row.openingHook,
      emotionalArc: row.emotionalArc,
      actBeats: parseActBeats(row.actBeats),
      payoffOrCliffhanger: row.payoffOrCliffhanger,
      status: row.episodeStatus,
      expansionVersion: row.expansionVersion,
    },
  };
}
