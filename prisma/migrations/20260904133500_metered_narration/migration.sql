-- Track the exact successful billing intent that produced a scene narration.
-- This lets retries return the persisted audio only for the same text/voice/speed
-- operation, while a later narration revision receives its own token charge.
ALTER TABLE "VideoScene"
  ADD COLUMN IF NOT EXISTS "narrationOperationKey" TEXT;

CREATE INDEX IF NOT EXISTS "VideoScene_narrationOperationKey_idx"
  ON "VideoScene"("narrationOperationKey");
