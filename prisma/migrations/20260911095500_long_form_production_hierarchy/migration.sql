-- Vidora long-form production hierarchy.
-- Stores validated story-bible architecture independently from short-form VideoProject scenes.

CREATE TABLE IF NOT EXISTS "LongFormProduction" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "format" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'planned',
  "storyBible" TEXT NOT NULL,
  "totalTargetMinutes" INTEGER NOT NULL,
  "planningReferenceId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LongFormProduction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LongFormProduction_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LongFormProduction_totalTargetMinutes_positive" CHECK ("totalTargetMinutes" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "LongFormProduction_planningReferenceId_key"
  ON "LongFormProduction"("planningReferenceId");
CREATE INDEX IF NOT EXISTS "LongFormProduction_userId_updatedAt_idx"
  ON "LongFormProduction"("userId", "updatedAt");
CREATE INDEX IF NOT EXISTS "LongFormProduction_status_updatedAt_idx"
  ON "LongFormProduction"("status", "updatedAt");

CREATE TABLE IF NOT EXISTS "LongFormSeason" (
  "id" TEXT NOT NULL,
  "productionId" TEXT NOT NULL,
  "seasonNumber" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "arc" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LongFormSeason_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LongFormSeason_productionId_fkey"
    FOREIGN KEY ("productionId") REFERENCES "LongFormProduction"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LongFormSeason_number_positive" CHECK ("seasonNumber" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "LongFormSeason_productionId_seasonNumber_key"
  ON "LongFormSeason"("productionId", "seasonNumber");
CREATE INDEX IF NOT EXISTS "LongFormSeason_productionId_idx"
  ON "LongFormSeason"("productionId");

CREATE TABLE IF NOT EXISTS "LongFormEpisode" (
  "id" TEXT NOT NULL,
  "seasonId" TEXT NOT NULL,
  "episodeNumber" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "logline" TEXT NOT NULL,
  "targetMinutes" INTEGER NOT NULL,
  "openingHook" TEXT NOT NULL,
  "emotionalArc" TEXT NOT NULL,
  "actBeats" TEXT NOT NULL,
  "payoffOrCliffhanger" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'planned',
  "expansionVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LongFormEpisode_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LongFormEpisode_seasonId_fkey"
    FOREIGN KEY ("seasonId") REFERENCES "LongFormSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LongFormEpisode_number_positive" CHECK ("episodeNumber" > 0),
  CONSTRAINT "LongFormEpisode_targetMinutes_positive" CHECK ("targetMinutes" > 0),
  CONSTRAINT "LongFormEpisode_expansionVersion_nonnegative" CHECK ("expansionVersion" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "LongFormEpisode_seasonId_episodeNumber_key"
  ON "LongFormEpisode"("seasonId", "episodeNumber");
CREATE INDEX IF NOT EXISTS "LongFormEpisode_seasonId_idx"
  ON "LongFormEpisode"("seasonId");
CREATE INDEX IF NOT EXISTS "LongFormEpisode_status_updatedAt_idx"
  ON "LongFormEpisode"("status", "updatedAt");

CREATE TABLE IF NOT EXISTS "LongFormSequence" (
  "id" TEXT NOT NULL,
  "episodeId" TEXT NOT NULL,
  "sequenceNumber" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "startState" TEXT NOT NULL,
  "endState" TEXT NOT NULL,
  "targetSeconds" INTEGER NOT NULL,
  "continuitySnapshot" TEXT NOT NULL DEFAULT '{}',
  "scenePlan" TEXT,
  "status" TEXT NOT NULL DEFAULT 'planned',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LongFormSequence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LongFormSequence_episodeId_fkey"
    FOREIGN KEY ("episodeId") REFERENCES "LongFormEpisode"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LongFormSequence_number_positive" CHECK ("sequenceNumber" > 0),
  CONSTRAINT "LongFormSequence_targetSeconds_positive" CHECK ("targetSeconds" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "LongFormSequence_episodeId_sequenceNumber_key"
  ON "LongFormSequence"("episodeId", "sequenceNumber");
CREATE INDEX IF NOT EXISTS "LongFormSequence_episodeId_idx"
  ON "LongFormSequence"("episodeId");
CREATE INDEX IF NOT EXISTS "LongFormSequence_status_updatedAt_idx"
  ON "LongFormSequence"("status", "updatedAt");
