ALTER TABLE "MediaAsset"
  ADD COLUMN IF NOT EXISTS "durationSeconds" DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS "TalkingPhotoJob" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "imageAssetId" TEXT NOT NULL,
  "audioAssetId" TEXT NOT NULL,
  "activeKey" TEXT,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "durationSeconds" DOUBLE PRECISION NOT NULL,
  "consentConfirmedAt" TIMESTAMP(3) NOT NULL,
  "billingQuoteId" TEXT,
  "creditReservationId" TEXT,
  "providerTaskId" TEXT,
  "videoUrl" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TalkingPhotoJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TalkingPhotoJob_duration_positive" CHECK ("durationSeconds" > 0 AND "durationSeconds" <= 600),
  CONSTRAINT "TalkingPhotoJob_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TalkingPhotoJob_imageAssetId_fkey"
    FOREIGN KEY ("imageAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TalkingPhotoJob_audioAssetId_fkey"
    FOREIGN KEY ("audioAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "TalkingPhotoJob_activeKey_key"
  ON "TalkingPhotoJob"("activeKey");

CREATE INDEX IF NOT EXISTS "TalkingPhotoJob_userId_createdAt_idx"
  ON "TalkingPhotoJob"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "TalkingPhotoJob_status_updatedAt_idx"
  ON "TalkingPhotoJob"("status", "updatedAt");

CREATE INDEX IF NOT EXISTS "TalkingPhotoJob_providerTaskId_idx"
  ON "TalkingPhotoJob"("providerTaskId");
