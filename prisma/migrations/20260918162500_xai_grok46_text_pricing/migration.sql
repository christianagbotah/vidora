-- xAI Grok 4.6 Billing v2 text catalog.
-- Official source verified 2026-09-18:
-- https://docs.x.ai/developers/pricing
--
-- Vidora rejects paid text inputs above 128k UTF-8 bytes before provider
-- submission, keeping this execution path below xAI's 200k long-context
-- threshold. These are therefore the official short-context rates.
-- Cached-input discounts are intentionally not assumed when reserving customer
-- credits; using the full input rate remains conservative.
INSERT INTO "ProviderPrice" (
  "id","provider","model","operation","billingUnit","unitPriceUsd",
  "unitsPerPrice","sourceUrl","pricingVersion","active","verifiedAt",
  "effectiveFrom","effectiveUntil","createdAt","updatedAt"
) VALUES
(
  'xai-grok46-text-input-20260918','xai','grok-4.6','text_input','token',2.00,
  1000000,'https://docs.x.ai/developers/pricing','xai-grok-4.6-short-2026-09-18',
  TRUE,'2026-09-18T00:00:00.000Z',CURRENT_TIMESTAMP,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
),
(
  'xai-grok46-text-output-20260918','xai','grok-4.6','text_output','token',6.00,
  1000000,'https://docs.x.ai/developers/pricing','xai-grok-4.6-short-2026-09-18',
  TRUE,'2026-09-18T00:00:00.000Z',CURRENT_TIMESTAMP,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
)
ON CONFLICT ("provider","model","operation") DO UPDATE SET
  "billingUnit" = EXCLUDED."billingUnit",
  "unitPriceUsd" = EXCLUDED."unitPriceUsd",
  "unitsPerPrice" = EXCLUDED."unitsPerPrice",
  "sourceUrl" = EXCLUDED."sourceUrl",
  "pricingVersion" = EXCLUDED."pricingVersion",
  "active" = TRUE,
  "verifiedAt" = EXCLUDED."verifiedAt",
  "effectiveFrom" = CURRENT_TIMESTAMP,
  "effectiveUntil" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP;
