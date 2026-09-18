-- Verified against fal's official Sync-3 image-to-video model page on 2026-09-18.
-- Price: USD 0.1333 per output second.
-- Source: https://fal.ai/models/fal-ai/sync-lipsync/v3/image-to-video

INSERT INTO "ProviderPrice" (
  "id", "provider", "model", "operation", "billingUnit",
  "unitPriceUsd", "unitsPerPrice", "sourceUrl", "pricingVersion",
  "active", "verifiedAt", "effectiveFrom", "createdAt", "updatedAt"
) VALUES (
  'provider-price-fal-sync3-image-to-video-lipsync-20260918',
  'fal',
  'fal-ai/sync-lipsync/v3/image-to-video',
  'lip_sync',
  'second',
  0.1333,
  1,
  'https://fal.ai/models/fal-ai/sync-lipsync/v3/image-to-video',
  'fal-sync3-image-to-video-2026-09-18',
  TRUE,
  TIMESTAMP '2026-09-18 00:00:00',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("provider", "model", "operation") DO UPDATE SET
  "billingUnit" = EXCLUDED."billingUnit",
  "unitPriceUsd" = EXCLUDED."unitPriceUsd",
  "unitsPerPrice" = EXCLUDED."unitsPerPrice",
  "sourceUrl" = EXCLUDED."sourceUrl",
  "pricingVersion" = EXCLUDED."pricingVersion",
  "active" = TRUE,
  "verifiedAt" = EXCLUDED."verifiedAt",
  "effectiveFrom" = EXCLUDED."effectiveFrom",
  "effectiveUntil" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP;
