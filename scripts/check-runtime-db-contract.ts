import { db } from "../src/lib/db";
import { getAIProviderSettings } from "../src/lib/ai-provider-router-qwen";
import { resolveQwenTtsModel } from "../src/lib/qwen-tts";
import {
  resolveZaiAsrBillingModel,
  resolveZaiImageBillingModel,
  resolveZaiTextBillingModel,
  resolveZaiVideoBillingModel,
  resolveZaiVisionBillingModel,
} from "../src/lib/zai-billing-models";

interface ColumnRow { column_name: string }
interface IndexRow { indexname: string; indexdef: string }
interface TableRow { table_name: string }
interface ProviderPriceRow { provider: string; model: string; operation: string; unitPriceUsd: number; unitsPerPrice: number; active: boolean }
interface PolicyRow { id: string; creditValueUsd: number; billingEnabled: boolean }

const BILLING_V2_CREDIT_VALUE_USD = 0.05;
const CREDIT_VALUE_EPSILON = 1e-9;

function hasUniqueIndex(indexes: IndexRow[], column: string): boolean {
  const needle = `(\"${column.toLowerCase()}\")`;
  return indexes.some((row) => {
    const normalized = row.indexdef.replace(/\s+/g, " ").toLowerCase();
    return normalized.includes("create unique index") && normalized.includes(needle);
  });
}

async function main(): Promise<void> {
  const exportColumns = await db.$queryRaw<ColumnRow[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ExportJob'
      AND column_name IN ('activeKey', 'params', 'status', 'updatedAt')
  `;
  const exportColumnNames = new Set(exportColumns.map((row) => row.column_name));
  const missingExportColumns = ['activeKey', 'params', 'status', 'updatedAt'].filter((name) => !exportColumnNames.has(name));
  if (missingExportColumns.length) {
    throw new Error(`Runtime DB contract failed: ExportJob is missing column(s): ${missingExportColumns.join(', ')}`);
  }

  const exportIndexes = await db.$queryRaw<IndexRow[]>`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'ExportJob'
  `;
  if (!hasUniqueIndex(exportIndexes, 'activekey')) {
    throw new Error('Runtime DB contract failed: ExportJob.activeKey does not have the required unique index');
  }

  const requiredBillingTables = [
    'ProviderPrice',
    'CommercialPricingPolicy',
    'BillingQuote',
    'CreditReservation',
    'ProviderUsageLedger',
  ];
  const tables = await db.$queryRaw<TableRow[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('ProviderPrice','CommercialPricingPolicy','BillingQuote','CreditReservation','ProviderUsageLedger')
  `;
  const tableNames = new Set(tables.map((row) => row.table_name));
  const missingTables = requiredBillingTables.filter((name) => !tableNames.has(name));
  if (missingTables.length) {
    throw new Error(`Runtime DB contract failed: provider billing table(s) missing: ${missingTables.join(', ')}`);
  }

  const requiredLongFormTables = [
    'LongFormProduction',
    'LongFormSeason',
    'LongFormEpisode',
    'LongFormSequence',
  ];
  const longFormTables = await db.$queryRaw<TableRow[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('LongFormProduction','LongFormSeason','LongFormEpisode','LongFormSequence')
  `;
  const longFormTableNames = new Set(longFormTables.map((row) => row.table_name));
  const missingLongFormTables = requiredLongFormTables.filter((name) => !longFormTableNames.has(name));
  if (missingLongFormTables.length) {
    throw new Error(`Runtime DB contract failed: long-form hierarchy table(s) missing: ${missingLongFormTables.join(', ')}`);
  }

  const longFormEpisodeColumns = await db.$queryRaw<ColumnRow[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'LongFormEpisode'
      AND column_name IN ('expansionVersion','expansionActiveKey','expansionClaimedAt')
  `;
  const longFormEpisodeColumnNames = new Set(longFormEpisodeColumns.map((row) => row.column_name));
  const missingLongFormEpisodeColumns = ['expansionVersion', 'expansionActiveKey', 'expansionClaimedAt']
    .filter((name) => !longFormEpisodeColumnNames.has(name));
  if (missingLongFormEpisodeColumns.length) {
    throw new Error(`Runtime DB contract failed: LongFormEpisode expansion column(s) missing: ${missingLongFormEpisodeColumns.join(', ')}`);
  }

  const longFormIndexes = await db.$queryRaw<IndexRow[]>`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename IN ('LongFormProduction','LongFormSeason','LongFormEpisode','LongFormSequence')
  `;
  const longFormIndexNames = new Set(longFormIndexes.map((row) => row.indexname));
  const requiredLongFormIndexes = [
    'LongFormProduction_planningReferenceId_key',
    'LongFormSeason_productionId_seasonNumber_key',
    'LongFormEpisode_seasonId_episodeNumber_key',
    'LongFormEpisode_expansionActiveKey_key',
    'LongFormSequence_episodeId_sequenceNumber_key',
  ];
  const missingLongFormIndexes = requiredLongFormIndexes.filter((name) => !longFormIndexNames.has(name));
  if (missingLongFormIndexes.length) {
    throw new Error(`Runtime DB contract failed: long-form hierarchy index(es) missing: ${missingLongFormIndexes.join(', ')}`);
  }

  const requiredPhotoStudioTables = ['MediaAsset', 'CharacterProfile'];
  const photoStudioTables = await db.$queryRaw<TableRow[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('MediaAsset','CharacterProfile')
  `;
  const photoStudioTableNames = new Set(photoStudioTables.map((row) => row.table_name));
  const missingPhotoStudioTables = requiredPhotoStudioTables.filter((name) => !photoStudioTableNames.has(name));
  if (missingPhotoStudioTables.length) {
    throw new Error(`Runtime DB contract failed: Photo Studio table(s) missing: ${missingPhotoStudioTables.join(', ')}`);
  }

  const characterProfileColumns = await db.$queryRaw<ColumnRow[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Character'
      AND column_name IN ('sourceProfileId')
  `;
  if (!characterProfileColumns.some((row) => row.column_name === 'sourceProfileId')) {
    throw new Error('Runtime DB contract failed: Character.sourceProfileId is missing');
  }

  const mediaAssetIndexes = await db.$queryRaw<IndexRow[]>`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'MediaAsset'
  `;
  if (!mediaAssetIndexes.some((row) => row.indexname === 'MediaAsset_userId_sha256_key')) {
    throw new Error('Runtime DB contract failed: MediaAsset owner/hash dedup index is missing');
  }

  const talkingPhotoTables = await db.$queryRaw<TableRow[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'TalkingPhotoJob'
  `;
  if (!talkingPhotoTables.some((row) => row.table_name === 'TalkingPhotoJob')) {
    throw new Error('Runtime DB contract failed: TalkingPhotoJob table is missing');
  }

  const talkingPhotoAssetColumns = await db.$queryRaw<ColumnRow[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'MediaAsset'
      AND column_name IN ('durationSeconds')
  `;
  if (!talkingPhotoAssetColumns.some((row) => row.column_name === 'durationSeconds')) {
    throw new Error('Runtime DB contract failed: MediaAsset.durationSeconds is missing');
  }

  const talkingPhotoColumns = await db.$queryRaw<ColumnRow[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'TalkingPhotoJob'
      AND column_name IN (
        'activeKey','status','durationSeconds','consentConfirmedAt',
        'billingQuoteId','creditReservationId','providerTaskId','videoUrl','error',
        'reconciliationKind','reconciliationAt','reconciliationResolution',
        'reconciledAt','reconciledByUserId','updatedAt'
      )
  `;
  const talkingPhotoColumnNames = new Set(talkingPhotoColumns.map((row) => row.column_name));
  const missingTalkingPhotoColumns = [
    'activeKey','status','durationSeconds','consentConfirmedAt',
    'billingQuoteId','creditReservationId','providerTaskId','videoUrl','error',
    'reconciliationKind','reconciliationAt','reconciliationResolution',
    'reconciledAt','reconciledByUserId','updatedAt',
  ].filter((name) => !talkingPhotoColumnNames.has(name));
  if (missingTalkingPhotoColumns.length) {
    throw new Error(`Runtime DB contract failed: TalkingPhotoJob column(s) missing: ${missingTalkingPhotoColumns.join(', ')}`);
  }

  const talkingPhotoIndexes = await db.$queryRaw<IndexRow[]>`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'TalkingPhotoJob'
  `;
  if (!hasUniqueIndex(talkingPhotoIndexes, 'activekey')) {
    throw new Error('Runtime DB contract failed: TalkingPhotoJob.activeKey must be unique');
  }
  const talkingPhotoIndexNames = new Set(talkingPhotoIndexes.map((row) => row.indexname));
  for (const required of [
    'TalkingPhotoJob_userId_createdAt_idx',
    'TalkingPhotoJob_status_updatedAt_idx',
    'TalkingPhotoJob_providerTaskId_idx',
    'TalkingPhotoJob_reconciliationKind_reconciliationAt_idx',
  ]) {
    if (!talkingPhotoIndexNames.has(required)) {
      throw new Error(`Runtime DB contract failed: Talking Photo index missing: ${required}`);
    }
  }

  const generationColumns = await db.$queryRaw<ColumnRow[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'GenerationRun'
      AND column_name IN ('billingQuoteId','creditReservationId')
  `;
  const generationColumnNames = new Set(generationColumns.map((row) => row.column_name));
  const missingGenerationColumns = ['billingQuoteId', 'creditReservationId'].filter((name) => !generationColumnNames.has(name));
  if (missingGenerationColumns.length) {
    throw new Error(`Runtime DB contract failed: GenerationRun billing column(s) missing: ${missingGenerationColumns.join(', ')}`);
  }

  const reservationIndexes = await db.$queryRaw<IndexRow[]>`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'CreditReservation'
  `;
  if (!hasUniqueIndex(reservationIndexes, 'quoteid')) {
    throw new Error('Runtime DB contract failed: CreditReservation.quoteId must be unique');
  }
  if (!hasUniqueIndex(reservationIndexes, 'idempotencykey')) {
    throw new Error('Runtime DB contract failed: CreditReservation.idempotencyKey must be unique');
  }

  const usageIndexes = await db.$queryRaw<IndexRow[]>`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'ProviderUsageLedger'
  `;
  if (!hasUniqueIndex(usageIndexes, 'idempotencykey')) {
    throw new Error('Runtime DB contract failed: ProviderUsageLedger.idempotencyKey must be unique');
  }

  const policies = await db.$queryRaw<PolicyRow[]>`
    SELECT "id", "creditValueUsd", "billingEnabled"
    FROM "CommercialPricingPolicy" WHERE "id" = 'default' LIMIT 1
  `;
  const policyCreditValue = Number(policies[0]?.creditValueUsd);
  if (!policies[0] || !Number.isFinite(policyCreditValue) || policyCreditValue <= 0) {
    throw new Error('Runtime DB contract failed: default commercial pricing policy is missing or invalid');
  }
  if (Math.abs(policyCreditValue - BILLING_V2_CREDIT_VALUE_USD) > CREDIT_VALUE_EPSILON) {
    throw new Error(
      `Runtime DB contract failed: Billing v2 credit value must be $${BILLING_V2_CREDIT_VALUE_USD.toFixed(2)}; found $${policyCreditValue.toFixed(6)}`,
    );
  }

  const prices = await db.$queryRaw<ProviderPriceRow[]>`
    SELECT "provider", "model", "operation", "unitPriceUsd", "unitsPerPrice", "active"
    FROM "ProviderPrice" WHERE "active" = TRUE
  `;
  const priceKeys = new Set(prices
    .filter((row) => Number(row.unitPriceUsd) > 0 && Number(row.unitsPerPrice) > 0)
    .map((row) => `${row.provider}:${row.model}:${row.operation}`));

  const providerSettings = await getAIProviderSettings();
  if (providerSettings.textProvider !== 'zai') {
    throw new Error(`Runtime DB contract failed: paid text provider ${providerSettings.textProvider} has no verified Billing v2 catalog; configure Z.ai`);
  }
  if (providerSettings.ttsProvider !== 'qwen') {
    throw new Error(`Runtime DB contract failed: paid narration provider ${providerSettings.ttsProvider} has no verified Billing v2 catalog; configure Qwen`);
  }

  const configuredTextModel = resolveZaiTextBillingModel(providerSettings.textModel);
  const configuredVisionModel = resolveZaiVisionBillingModel();
  const configuredAsrModel = resolveZaiAsrBillingModel();
  const configuredImageModel = resolveZaiImageBillingModel();
  const configuredVideoModel = resolveZaiVideoBillingModel(null, false);
  const configuredQwenModel = resolveQwenTtsModel(providerSettings.ttsModel);
  const requiredPrices = [
    'zai:glm-4.7:text_input',
    'zai:glm-4.7:text_output',
    'zai:glm-4.6v:vision_input',
    'zai:glm-4.6v:vision_output',
    'zai:glm-asr-2512:asr',
    'zai:search-prime:web_search',
    `zai:${configuredTextModel}:text_input`,
    `zai:${configuredTextModel}:text_output`,
    `zai:${configuredVisionModel}:vision_input`,
    `zai:${configuredVisionModel}:vision_output`,
    `zai:${configuredAsrModel}:asr`,
    'zai:CogVideoX-3:video_generation',
    'zai:vidu2-image:video_generation',
    'zai:vidu2-reference:video_generation',
    'zai:viduq1-text:video_generation',
    'zai:viduq1-image:video_generation',
    'zai:cogview-4-250304:image_generation',
    'zai:glm-image:image_generation',
    `zai:${configuredImageModel}:image_generation`,
    `zai:${configuredVideoModel}:video_generation`,
    'qwen:qwen3-tts-instruct-flash:tts',
    `qwen:${configuredQwenModel}:tts`,
    'fal:fal-ai/sync-lipsync/v3/image-to-video:lip_sync',
  ];
  const missingPrices = [...new Set(requiredPrices)].filter((key) => !priceKeys.has(key));
  if (missingPrices.length) {
    throw new Error(`Runtime DB contract failed: active verified provider price(s) missing: ${missingPrices.join(', ')}`);
  }

  console.log('Runtime DB contract: OK (durable media lock + provider billing + fal Talking Photo catalog/execution/reconciliation schema + long-form hierarchy/lease + Photo Studio verified)');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
