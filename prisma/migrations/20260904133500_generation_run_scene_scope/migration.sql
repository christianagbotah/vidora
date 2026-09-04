-- Persist the exact set of scenes owned by a durable GenerationRun.
-- Existing rows remain compatible through the worker's targetSceneId/status fallback.
ALTER TABLE "GenerationRun"
  ADD COLUMN IF NOT EXISTS "sceneIds" TEXT NOT NULL DEFAULT '[]';
