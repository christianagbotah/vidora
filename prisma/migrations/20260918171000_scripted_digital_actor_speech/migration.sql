CREATE TABLE IF NOT EXISTS "TalkingPhotoSpeechJob" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "activeKey" TEXT,
  "status" TEXT NOT NULL DEFAULT 'reserving',
  "script" TEXT NOT NULL,
  "scriptSha256" TEXT NOT NULL,
  "voice" TEXT NOT NULL,
  "language" TEXT,
  "accent" TEXT,
  "style" TEXT,
  "providerModel" TEXT NOT NULL,
  "billingQuoteId" TEXT,
  "creditReservationId" TEXT,
  "outputAssetId" TEXT,
  "chunkCount" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TalkingPhotoSpeechJob_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "TalkingPhotoSpeechJob_activeKey_key"
  ON "TalkingPhotoSpeechJob"("activeKey");
CREATE INDEX IF NOT EXISTS "TalkingPhotoSpeechJob_userId_createdAt_idx"
  ON "TalkingPhotoSpeechJob"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "TalkingPhotoSpeechJob_status_updatedAt_idx"
  ON "TalkingPhotoSpeechJob"("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "TalkingPhotoSpeechJob_scriptSha256_idx"
  ON "TalkingPhotoSpeechJob"("scriptSha256");
