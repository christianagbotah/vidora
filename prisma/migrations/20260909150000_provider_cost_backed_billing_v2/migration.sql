-- Vidora Provider-Cost-Backed Billing v2
-- Customer credits are reserved before any paid provider boundary is crossed.
-- Provider prices are versioned and source-attributed so stale/unknown COGS fails closed.

ALTER TABLE "GenerationRun"
  ADD COLUMN IF NOT EXISTS "billingQuoteId" TEXT,
  ADD COLUMN IF NOT EXISTS "creditReservationId" TEXT;

CREATE TABLE IF NOT EXISTS "ProviderPrice" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "billingUnit" TEXT NOT NULL,
  "unitPriceUsd" DOUBLE PRECISION NOT NULL,
  "unitsPerPrice" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "sourceUrl" TEXT NOT NULL,
  "pricingVersion" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "verifiedAt" TIMESTAMP(3) NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderPrice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProviderPrice_unitPriceUsd_nonnegative" CHECK ("unitPriceUsd" >= 0),
  CONSTRAINT "ProviderPrice_unitsPerPrice_positive" CHECK ("unitsPerPrice" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProviderPrice_provider_model_operation_key"
  ON "ProviderPrice"("provider", "model", "operation");
CREATE INDEX IF NOT EXISTS "ProviderPrice_active_verifiedAt_idx"
  ON "ProviderPrice"("active", "verifiedAt");

CREATE TABLE IF NOT EXISTS "CommercialPricingPolicy" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "creditValueUsd" DOUBLE PRECISION NOT NULL DEFAULT 0.01,
  "targetGrossMarginPct" DOUBLE PRECISION NOT NULL DEFAULT 0.35,
  "providerSafetyBufferPct" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
  "fxSafetyBufferPct" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
  "gatewayFeeReservePct" DOUBLE PRECISION NOT NULL DEFAULT 0.03,
  "infrastructureReservePct" DOUBLE PRECISION NOT NULL DEFAULT 0.03,
  "minimumChargeCredits" INTEGER NOT NULL DEFAULT 1,
  "priceMaxAgeHours" INTEGER NOT NULL DEFAULT 1080,
  "quoteTtlMinutes" INTEGER NOT NULL DEFAULT 15,
  "billingEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercialPricingPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommercialPricingPolicy_creditValue_positive" CHECK ("creditValueUsd" > 0),
  CONSTRAINT "CommercialPricingPolicy_minimumCharge_positive" CHECK ("minimumChargeCredits" > 0),
  CONSTRAINT "CommercialPricingPolicy_priceAge_positive" CHECK ("priceMaxAgeHours" > 0),
  CONSTRAINT "CommercialPricingPolicy_quoteTtl_positive" CHECK ("quoteTtlMinutes" > 0)
);

INSERT INTO "CommercialPricingPolicy" ("id") VALUES ('default')
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "BillingQuote" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "projectId" TEXT,
  "operation" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "pricingVersion" TEXT NOT NULL,
  "providerCostUsd" DOUBLE PRECISION NOT NULL,
  "bufferedCostUsd" DOUBLE PRECISION NOT NULL,
  "customerPriceUsd" DOUBLE PRECISION NOT NULL,
  "creditsRequired" INTEGER NOT NULL,
  "breakdown" TEXT NOT NULL,
  "policySnapshot" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingQuote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillingQuote_costs_nonnegative" CHECK ("providerCostUsd" >= 0 AND "bufferedCostUsd" >= 0 AND "customerPriceUsd" >= 0),
  CONSTRAINT "BillingQuote_credits_positive" CHECK ("creditsRequired" > 0)
);
CREATE INDEX IF NOT EXISTS "BillingQuote_userId_createdAt_idx" ON "BillingQuote"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "BillingQuote_projectId_createdAt_idx" ON "BillingQuote"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "BillingQuote_status_expiresAt_idx" ON "BillingQuote"("status", "expiresAt");

CREATE TABLE IF NOT EXISTS "CreditReservation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "referenceId" TEXT,
  "operation" TEXT NOT NULL,
  "reservedCredits" INTEGER NOT NULL,
  "capturedCredits" INTEGER NOT NULL DEFAULT 0,
  "releasedCredits" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'reserved',
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreditReservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CreditReservation_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "BillingQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CreditReservation_amounts_valid" CHECK (
    "reservedCredits" > 0 AND "capturedCredits" >= 0 AND "releasedCredits" >= 0
    AND "capturedCredits" + "releasedCredits" <= "reservedCredits"
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "CreditReservation_quoteId_key" ON "CreditReservation"("quoteId");
CREATE UNIQUE INDEX IF NOT EXISTS "CreditReservation_idempotencyKey_key" ON "CreditReservation"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "CreditReservation_userId_status_idx" ON "CreditReservation"("userId", "status");
CREATE INDEX IF NOT EXISTS "CreditReservation_referenceId_idx" ON "CreditReservation"("referenceId");

CREATE TABLE IF NOT EXISTS "ProviderUsageLedger" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "projectId" TEXT,
  "sceneId" TEXT,
  "generationRunId" TEXT,
  "reservationId" TEXT,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "billingUnit" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "providerCostUsd" DOUBLE PRECISION NOT NULL,
  "customerCredits" INTEGER NOT NULL,
  "customerValueUsd" DOUBLE PRECISION NOT NULL,
  "grossProfitUsd" DOUBLE PRECISION NOT NULL,
  "grossMarginPct" DOUBLE PRECISION NOT NULL,
  "providerTaskId" TEXT,
  "pricingVersion" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'captured',
  "idempotencyKey" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderUsageLedger_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProviderUsageLedger_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "ProviderUsageLedger_values_nonnegative" CHECK (
    "providerCostUsd" >= 0 AND "customerCredits" > 0 AND "customerValueUsd" >= 0
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProviderUsageLedger_idempotencyKey_key" ON "ProviderUsageLedger"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "ProviderUsageLedger_userId_createdAt_idx" ON "ProviderUsageLedger"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProviderUsageLedger_projectId_createdAt_idx" ON "ProviderUsageLedger"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProviderUsageLedger_provider_model_idx" ON "ProviderUsageLedger"("provider", "model");
CREATE INDEX IF NOT EXISTS "ProviderUsageLedger_generationRunId_idx" ON "ProviderUsageLedger"("generationRunId");

-- Official provider COGS snapshots verified 2026-09-09.
-- Z.ai pricing source: https://docs.z.ai/guides/overview/pricing
INSERT INTO "ProviderPrice" ("id","provider","model","operation","billingUnit","unitPriceUsd","unitsPerPrice","sourceUrl","pricingVersion","verifiedAt") VALUES
('zai-glm47-text-input-20260909','zai','glm-4.7','text_input','token',0.60,1000000,'https://docs.z.ai/guides/overview/pricing','zai-2026-09-09','2026-09-09T00:00:00.000Z'),
('zai-glm47-text-output-20260909','zai','glm-4.7','text_output','token',2.20,1000000,'https://docs.z.ai/guides/overview/pricing','zai-2026-09-09','2026-09-09T00:00:00.000Z'),
('zai-glm46v-vision-input-20260909','zai','glm-4.6v','vision_input','token',0.30,1000000,'https://docs.z.ai/guides/overview/pricing','zai-2026-09-09','2026-09-09T00:00:00.000Z'),
('zai-glm46v-vision-output-20260909','zai','glm-4.6v','vision_output','token',0.90,1000000,'https://docs.z.ai/guides/overview/pricing','zai-2026-09-09','2026-09-09T00:00:00.000Z'),
('zai-glm-asr-2512-20260909','zai','glm-asr-2512','asr','minute',0.0024,1,'https://docs.z.ai/guides/overview/pricing','zai-2026-09-09','2026-09-09T00:00:00.000Z'),
('zai-cogvideox3-video-20260909','zai','CogVideoX-3','video_generation','request',0.20,1,'https://docs.z.ai/guides/overview/pricing','zai-2026-09-09','2026-09-09T00:00:00.000Z'),
('zai-vidu2-image-video-20260909','zai','vidu2-image','video_generation','request',0.20,1,'https://docs.z.ai/guides/overview/pricing','zai-2026-09-09','2026-09-09T00:00:00.000Z'),
('zai-vidu2-reference-video-20260909','zai','vidu2-reference','video_generation','request',0.40,1,'https://docs.z.ai/guides/overview/pricing','zai-2026-09-09','2026-09-09T00:00:00.000Z'),
('zai-viduq1-text-video-20260909','zai','viduq1-text','video_generation','request',0.40,1,'https://docs.z.ai/guides/overview/pricing','zai-2026-09-09','2026-09-09T00:00:00.000Z'),
('zai-viduq1-image-video-20260909','zai','viduq1-image','video_generation','request',0.40,1,'https://docs.z.ai/guides/overview/pricing','zai-2026-09-09','2026-09-09T00:00:00.000Z'),
('zai-cogview4-image-20260909','zai','cogview-4-250304','image_generation','image',0.01,1,'https://docs.z.ai/guides/overview/pricing','zai-2026-09-09','2026-09-09T00:00:00.000Z'),
('zai-glm-image-20260909','zai','glm-image','image_generation','image',0.015,1,'https://docs.z.ai/guides/overview/pricing','zai-2026-09-09','2026-09-09T00:00:00.000Z'),
('qwen-instruct-flash-tts-20260909','qwen','qwen3-tts-instruct-flash','tts','character',0.115,10000,'https://www.alibabacloud.com/help/en/model-studio/model-pricing','qwen-2026-09-09','2026-09-09T00:00:00.000Z'),
('qwen-flash-tts-20260909','qwen','qwen3-tts-flash','tts','character',0.10,10000,'https://www.alibabacloud.com/help/en/model-studio/model-pricing','qwen-2026-09-09','2026-09-09T00:00:00.000Z')
ON CONFLICT ("provider", "model", "operation") DO UPDATE SET
  "billingUnit" = EXCLUDED."billingUnit",
  "unitPriceUsd" = EXCLUDED."unitPriceUsd",
  "unitsPerPrice" = EXCLUDED."unitsPerPrice",
  "sourceUrl" = EXCLUDED."sourceUrl",
  "pricingVersion" = EXCLUDED."pricingVersion",
  "verifiedAt" = EXCLUDED."verifiedAt",
  "active" = TRUE,
  "updatedAt" = CURRENT_TIMESTAMP;
