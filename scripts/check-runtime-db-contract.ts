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
  if (!policies[0] || !Number.isFinite(Number(policies[0].creditValueUsd)) || Number(policies[0].creditValueUsd) <= 0) {
    throw new Error('Runtime DB contract failed: default commercial pricing policy is missing or invalid');
  }

  const prices = await db.$queryRaw<ProviderPriceRow[]>`
    SELECT "provider", "model", "operation", "unitPriceUsd", "unitsPerPrice", "active"
    FROM "ProviderPrice" WHERE "active" = TRUE
  `;
  const priceKeys = new Set(prices
    .filter((row) => Number(row.unitPriceUsd) > 0 && Number(row.unitsPerPrice) > 0)
    .map((row) => `${row.provider}:${row.model}:${row.operation}`));

  // Resolve the same DB-backed provider settings used by runtime. Environment
  // validation alone is insufficient because Admin can select a different text
  // or TTS model without changing the process environment.
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
  ];
  const missingPrices = [...new Set(requiredPrices)].filter((key) => !priceKeys.has(key));
  if (missingPrices.length) {
    throw new Error(`Runtime DB contract failed: active verified provider price(s) missing: ${missingPrices.join(', ')}`);
  }

  console.log('Runtime DB contract: OK (durable media lock + exact provider-cost billing contract verified)');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });