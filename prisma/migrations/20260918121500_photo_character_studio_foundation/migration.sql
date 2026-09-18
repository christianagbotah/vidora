CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'image',
    "source" TEXT NOT NULL DEFAULT 'upload',
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CharacterProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "description" TEXT,
    "stylePrompt" TEXT,
    "voiceId" TEXT,
    "primaryAssetId" TEXT,
    "referenceAssetIds" TEXT NOT NULL DEFAULT '[]',
    "performanceProfile" TEXT NOT NULL DEFAULT '{}',
    "consentStatus" TEXT NOT NULL DEFAULT 'unconfirmed',
    "consentConfirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CharacterProfile_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Character" ADD COLUMN "sourceProfileId" TEXT;

CREATE UNIQUE INDEX "MediaAsset_userId_sha256_key" ON "MediaAsset"("userId", "sha256");
CREATE INDEX "MediaAsset_userId_createdAt_idx" ON "MediaAsset"("userId", "createdAt");
CREATE INDEX "CharacterProfile_userId_createdAt_idx" ON "CharacterProfile"("userId", "createdAt");
CREATE INDEX "CharacterProfile_primaryAssetId_idx" ON "CharacterProfile"("primaryAssetId");
CREATE INDEX "Character_sourceProfileId_idx" ON "Character"("sourceProfileId");

ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "MediaAsset_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CharacterProfile"
  ADD CONSTRAINT "CharacterProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CharacterProfile"
  ADD CONSTRAINT "CharacterProfile_primaryAssetId_fkey"
  FOREIGN KEY ("primaryAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Character"
  ADD CONSTRAINT "Character_sourceProfileId_fkey"
  FOREIGN KEY ("sourceProfileId") REFERENCES "CharacterProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
