-- Scope durable GenerationRun rows to one scene when the request originated
-- from the single-scene generation endpoint. Batch generation keeps NULL.

ALTER TABLE "GenerationRun"
  ADD COLUMN IF NOT EXISTS "targetSceneId" TEXT;

CREATE INDEX IF NOT EXISTS "GenerationRun_targetSceneId_idx"
  ON "GenerationRun"("targetSceneId");
