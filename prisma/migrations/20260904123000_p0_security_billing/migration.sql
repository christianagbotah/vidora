-- Vidora P0 security/billing hardening migration.
-- Designed for the existing PostgreSQL production schema. It is intentionally
-- fail-closed if historical data violates new financial uniqueness/invariants.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Payment"
  ADD COLUMN IF NOT EXISTS "packageSlug" TEXT,
  ADD COLUMN IF NOT EXISTS "expectedAmountMinor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "bonusTokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "providerTransactionId" TEXT,
  ADD COLUMN IF NOT EXISTS "settlementKey" TEXT,
  ADD COLUMN IF NOT EXISTS "settledAt" TIMESTAMP(3);

UPDATE "Payment"
SET "expectedAmountMinor" = ROUND("amount" * 100)::INTEGER
WHERE "expectedAmountMinor" = 0 AND "amount" > 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Payment"
    WHERE "gatewayRef" IS NOT NULL
    GROUP BY "gateway", "gatewayRef"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot apply Vidora payment uniqueness: duplicate (gateway, gatewayRef) rows exist';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Payment_gateway_gatewayRef_key"
  ON "Payment"("gateway", "gatewayRef");
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_settlementKey_key"
  ON "Payment"("settlementKey");
CREATE INDEX IF NOT EXISTS "Payment_status_idx" ON "Payment"("status");

ALTER TABLE "TokenTransaction"
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
  ADD COLUMN IF NOT EXISTS "relatedTransactionId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "TokenTransaction_idempotencyKey_key"
  ON "TokenTransaction"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "TokenTransaction_referenceId_idx"
  ON "TokenTransaction"("referenceId");

ALTER TABLE "ExportJob"
  ADD COLUMN IF NOT EXISTS "activeKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "ExportJob_activeKey_key"
  ON "ExportJob"("activeKey");

CREATE TABLE IF NOT EXISTS "GenerationRun" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "activeKey" TEXT,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "totalTokens" INTEGER NOT NULL,
  "tokensPerScene" INTEGER NOT NULL,
  "costUsdPerScene" DOUBLE PRECISION NOT NULL,
  "chargeTransactionId" TEXT,
  "refundTransactionId" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GenerationRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GenerationRun_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "GenerationRun_activeKey_key"
  ON "GenerationRun"("activeKey");
CREATE INDEX IF NOT EXISTS "GenerationRun_projectId_createdAt_idx"
  ON "GenerationRun"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "GenerationRun_status_updatedAt_idx"
  ON "GenerationRun"("status", "updatedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'User_tokens_nonnegative'
  ) THEN
    ALTER TABLE "User"
      ADD CONSTRAINT "User_tokens_nonnegative" CHECK ("tokens" >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Payment_expected_amount_nonnegative'
  ) THEN
    ALTER TABLE "Payment"
      ADD CONSTRAINT "Payment_expected_amount_nonnegative" CHECK ("expectedAmountMinor" >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Payment_token_entitlement_nonnegative'
  ) THEN
    ALTER TABLE "Payment"
      ADD CONSTRAINT "Payment_token_entitlement_nonnegative"
      CHECK ("tokensPurchased" >= 0 AND "bonusTokens" >= 0);
  END IF;
END $$;
