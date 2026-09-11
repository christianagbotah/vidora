-- Vidora Creative Research — verified Z.ai Web Search COGS.
-- Official pricing verified 2026-09-11: Web Search = USD 0.01 per use.
-- API engine used by Vidora: search-prime.

INSERT INTO "ProviderPrice" (
  "id", "provider", "model", "operation", "billingUnit",
  "unitPriceUsd", "unitsPerPrice", "sourceUrl", "pricingVersion", "verifiedAt"
) VALUES (
  'zai-search-prime-web-search-20260911',
  'zai',
  'search-prime',
  'web_search',
  'request',
  0.01,
  1,
  'https://docs.z.ai/guides/overview/pricing',
  'zai-search-2026-09-11',
  '2026-09-11T00:00:00.000Z'
)
ON CONFLICT ("provider", "model", "operation") DO UPDATE SET
  "billingUnit" = EXCLUDED."billingUnit",
  "unitPriceUsd" = EXCLUDED."unitPriceUsd",
  "unitsPerPrice" = EXCLUDED."unitsPerPrice",
  "sourceUrl" = EXCLUDED."sourceUrl",
  "pricingVersion" = EXCLUDED."pricingVersion",
  "verifiedAt" = EXCLUDED."verifiedAt",
  "active" = TRUE,
  "effectiveUntil" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP;
