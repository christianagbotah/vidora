-- Persist the Create-page wizard before scenes are materialized.
-- Existing projects remain unchanged; only new/active drafts populate these fields.
ALTER TABLE "VideoProject"
  ADD COLUMN IF NOT EXISTS "draftData" TEXT,
  ADD COLUMN IF NOT EXISTS "lastAutosavedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "VideoProject_userId_lastAutosavedAt_idx"
  ON "VideoProject"("userId", "lastAutosavedAt");
