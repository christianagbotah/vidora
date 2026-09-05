-- Repair legacy production databases that were baselined after the Prisma
-- datamodel already contained storefront pricing models, but where these
-- physical tables had not yet been created. Fresh databases already receive
-- these tables from the baseline migration, so this migration is idempotent.

CREATE TABLE IF NOT EXISTS "EnginePricing" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "priceGHS" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priceUSD" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tokensPerClip" INTEGER NOT NULL DEFAULT 3,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnginePricing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EnginePricing_modelId_key"
    ON "EnginePricing"("modelId");

CREATE TABLE IF NOT EXISTS "PricingPlan" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "badge" TEXT,
    "priceGHS" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priceUSD" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "period" TEXT NOT NULL DEFAULT 'month',
    "features" TEXT NOT NULL DEFAULT '[]',
    "ctaLabel" TEXT NOT NULL DEFAULT 'Get Started',
    "ctaAction" TEXT NOT NULL DEFAULT 'create',
    "highlight" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricingPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PricingPlan_slug_key"
    ON "PricingPlan"("slug");

CREATE INDEX IF NOT EXISTS "PricingPlan_isActive_sortOrder_idx"
    ON "PricingPlan"("isActive", "sortOrder");
