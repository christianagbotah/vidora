import crypto from "crypto";
import { db } from "@/lib/db";
import type { LongFormSequencePlan } from "@/lib/long-form-sequence-planner";

interface EpisodeLockRow {
  id: string;
  expansionVersion: number;
}

export class LongFormExpansionConflictError extends Error {
  readonly code = "LONG_FORM_EXPANSION_VERSION_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "LongFormExpansionConflictError";
  }
}

export async function replaceLongFormEpisodeSequences(opts: {
  episodeId: string;
  userId: string;
  expectedExpansionVersion: number;
  sequences: LongFormSequencePlan[];
}): Promise<{ expansionVersion: number; sequenceCount: number }> {
  if (!Number.isSafeInteger(opts.expectedExpansionVersion) || opts.expectedExpansionVersion < 0) {
    throw new LongFormExpansionConflictError("Expected expansion version is invalid");
  }
  if (!opts.sequences.length) throw new Error("At least one sequence is required");

  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<EpisodeLockRow[]>`
      SELECT e."id", e."expansionVersion"
      FROM "LongFormEpisode" e
      INNER JOIN "LongFormSeason" s ON s."id" = e."seasonId"
      INNER JOIN "LongFormProduction" p ON p."id" = s."productionId"
      WHERE e."id" = ${opts.episodeId} AND p."userId" = ${opts.userId}
      LIMIT 1
      FOR UPDATE OF e
    `;
    const episode = rows[0];
    if (!episode) throw new Error("Long-form episode not found");
    if (episode.expansionVersion !== opts.expectedExpansionVersion) {
      throw new LongFormExpansionConflictError(
        `Episode expansion changed from version ${opts.expectedExpansionVersion} to ${episode.expansionVersion}; reload before replacing its sequence map`,
      );
    }

    await tx.$executeRaw`
      DELETE FROM "LongFormSequence" WHERE "episodeId" = ${opts.episodeId}
    `;

    for (const sequence of opts.sequences) {
      await tx.$executeRaw`
        INSERT INTO "LongFormSequence" (
          "id", "episodeId", "sequenceNumber", "title", "purpose", "startState", "endState",
          "targetSeconds", "continuitySnapshot", "scenePlan", "status", "createdAt", "updatedAt"
        ) VALUES (
          ${crypto.randomUUID()}, ${opts.episodeId}, ${sequence.sequenceNumber}, ${sequence.title},
          ${sequence.purpose}, ${sequence.startState}, ${sequence.endState}, ${sequence.targetSeconds},
          ${JSON.stringify(sequence.continuity)}, NULL, 'planned', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `;
    }

    const expansionVersion = episode.expansionVersion + 1;
    await tx.$executeRaw`
      UPDATE "LongFormEpisode"
      SET "status" = 'sequenced',
          "expansionVersion" = ${expansionVersion},
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${opts.episodeId}
    `;

    return {
      expansionVersion,
      sequenceCount: opts.sequences.length,
    };
  });
}

export async function listLongFormEpisodeSequences(opts: {
  episodeId: string;
  userId: string;
}): Promise<Array<{
  id: string;
  sequenceNumber: number;
  title: string;
  purpose: string;
  startState: string;
  endState: string;
  targetSeconds: number;
  continuity: Record<string, unknown>;
  status: string;
}>> {
  const rows = await db.$queryRaw<Array<{
    id: string;
    sequenceNumber: number;
    title: string;
    purpose: string;
    startState: string;
    endState: string;
    targetSeconds: number;
    continuitySnapshot: string;
    status: string;
  }>>`
    SELECT q."id", q."sequenceNumber", q."title", q."purpose", q."startState", q."endState",
           q."targetSeconds", q."continuitySnapshot", q."status"
    FROM "LongFormSequence" q
    INNER JOIN "LongFormEpisode" e ON e."id" = q."episodeId"
    INNER JOIN "LongFormSeason" s ON s."id" = e."seasonId"
    INNER JOIN "LongFormProduction" p ON p."id" = s."productionId"
    WHERE q."episodeId" = ${opts.episodeId} AND p."userId" = ${opts.userId}
    ORDER BY q."sequenceNumber" ASC
  `;

  return rows.map((row) => {
    let continuity: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(row.continuitySnapshot) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        continuity = parsed as Record<string, unknown>;
      }
    } catch {
      throw new Error(`Stored continuity snapshot for sequence ${row.id} is corrupted`);
    }
    return {
      id: row.id,
      sequenceNumber: row.sequenceNumber,
      title: row.title,
      purpose: row.purpose,
      startState: row.startState,
      endState: row.endState,
      targetSeconds: row.targetSeconds,
      continuity,
      status: row.status,
    };
  });
}
