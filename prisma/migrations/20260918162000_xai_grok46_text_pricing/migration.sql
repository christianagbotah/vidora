-- Verified against official xAI pricing on 2026-09-18.
-- grok-4.6 global API short-context (<200k prompt tokens):
-- input USD 2.00 / 1M tokens; output USD 6.00 / 1M tokens.
-- Source: https://docs.x.ai/developers/models/grok-4.6
INSERT INTO "ProviderPrice" (
  "id","provider","model","operation","billingUnit",
  "unitPriceUsd","unitsPerPrice","sourceUrl","pricingVersion",
  "active","verifiedAt","effectiveFrom","createdAt","updatedAt"
) VALUES
(
  'provider-price-xai-grok46-input-20260918','xai','grok-4.6','text_input','token',
  2.00,1000000,'https://docs.x.ai/developers/models/grok-4.6','xai-grok46-global-short-2026-09-18',
  TRUE,TIMESTAMP '2026-09-18 00:00:00',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
),
(
  'provider-price-xai-grok46-output-20260918','xai','grok-4.6','text_output','token',
  6.00,1000000,'https://docs.x.ai/developers/models/grok-4.6','xai-grok46-global-short-2026-09-18',
  TRUE,TIMESTAMP '2026-09-18 00:00:00',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
)
ON CONFLICT ("provider","model","operation") DO UPDATE SET
  "billingUnit"=EXCLUDED."billingUnit",
  "unitPriceUsd"=EXCLUDED."unitPriceUsd",
  "unitsPerPrice"=EXCLUDED."unitsPerPrice",
  "sourceUrl"=EXCLUDED."sourceUrl",
  "pricingVersion"=EXCLUDED."pricingVersion",
  "active"=TRUE,
  "verifiedAt"=EXCLUDED."verifiedAt",
  "effectiveFrom"=EXCLUDED."effectiveFrom",
  "effectiveUntil"=NULL,
  "updatedAt"=CURRENT_TIMESTAMP;
