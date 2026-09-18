ALTER TABLE "TalkingPhotoJob"
  ADD COLUMN IF NOT EXISTS "reconciliationKind" TEXT,
  ADD COLUMN IF NOT EXISTS "reconciliationAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reconciliationResolution" TEXT,
  ADD COLUMN IF NOT EXISTS "reconciledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reconciledByUserId" TEXT;

CREATE INDEX IF NOT EXISTS "TalkingPhotoJob_reconciliationKind_reconciliationAt_idx"
  ON "TalkingPhotoJob"("reconciliationKind", "reconciliationAt");
