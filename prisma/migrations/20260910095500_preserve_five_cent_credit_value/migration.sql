-- Preserve Vidora's established wallet denomination while keeping Billing v2
-- provider-cost-backed. The first Billing v2 migration briefly introduced a
-- one-cent default; this corrective migration restores the existing five-cent
-- customer credit value without overwriting an operator-customized policy.

ALTER TABLE "CommercialPricingPolicy"
  ALTER COLUMN "creditValueUsd" SET DEFAULT 0.05;

UPDATE "CommercialPricingPolicy"
SET "creditValueUsd" = 0.05,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'default'
  AND ABS("creditValueUsd" - 0.01) < 0.000000001;
