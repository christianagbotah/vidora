CREATE TABLE "TalkingPhotoSpeechJob" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "activeKey" TEXT,
  "scriptText" TEXT NOT NULL,
  "voice" TEXT NOT NULL,
  "language" TEXT NOT NULL DEFAULT 'en',
  "accent" TEXT NOT NULL DEFAULT 'auto',
  "model" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'quoted',
  "billingQuoteId" TEXT NOT NULL,
  "creditReservationId" TEXT,
  "outputAssetId" TEXT,
  "chunkCount" INTEGER NOT NULL,
  "completedChunks" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "reconciliationKind" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TalkingPhotoSpeechJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TalkingPhotoSpeechJob_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TalkingPhotoSpeechJob_outputAssetId_fkey"
    FOREIGN KEY ("outputAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TalkingPhotoSpeechJob_chunkCount_positive" CHECK ("chunkCount" > 0),
  CONSTRAINT "TalkingPhotoSpeechJob_completedChunks_nonnegative" CHECK ("completedChunks" >= 0)
);

CREATE UNIQUE INDEX "TalkingPhotoSpeechJob_activeKey_key"
  ON "TalkingPhotoSpeechJob"("activeKey");
CREATE UNIQUE INDEX "TalkingPhotoSpeechJob_billingQuoteId_key"
  ON "TalkingPhotoSpeechJob"("billingQuoteId");
CREATE INDEX "TalkingPhotoSpeechJob_userId_createdAt_idx"
  ON "TalkingPhotoSpeechJob"("userId", "createdAt");
CREATE INDEX "TalkingPhotoSpeechJob_userId_fingerprint_idx"
  ON "TalkingPhotoSpeechJob"("userId", "fingerprint");
CREATE INDEX "TalkingPhotoSpeechJob_status_updatedAt_idx"
  ON "TalkingPhotoSpeechJob"("status", "updatedAt");
CREATE INDEX "TalkingPhotoSpeechJob_outputAssetId_idx"
  ON "TalkingPhotoSpeechJob"("outputAssetId");
