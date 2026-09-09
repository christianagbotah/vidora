import { db } from "@/lib/db";

export type BillableProvider = "zai" | "qwen";
export type BillableOperation =
  | "video_generation"
  | "image_generation"
  | "tts"
  | "text_input"
  | "text_output"
  | "vision_input"
  | "vision_output"
  | "asr";
export type BillingUnit = "request" | "image" | "character" | "token" | "minute";

export interface ProviderPriceSnapshot {
  provider: BillableProvider;
  model: string;
  operation: BillableOperation;
  billingUnit: BillingUnit;
  unitPriceUsd: number;
  unitsPerPrice: number;
  sourceUrl: string;
  pricingVersion: string;
  verifiedAt: Date;
}

export interface CommercialPricingPolicy {
  creditValueUsd: number;
  targetGrossMarginPct: number;
  providerSafetyBufferPct: number;
  fxSafetyBufferPct: number;
  gatewayFeeReservePct: number;
  infrastructureReservePct: number;
  minimumChargeCredits: number;
  priceMaxAgeHours: number;
  quoteTtlMinutes: number;
  billingEnabled: boolean;
}

export interface CommercialCharge {
  providerCostUsd: number;
  providerSafetyUsd: number;
  fxReserveUsd: number;
  infrastructureReserveUsd: number;
  gatewayFeeReserveUsd: number;
  bufferedCostUsd: number;
  /** Commercial price before rounding up to whole Vidora credits. */
  customerPriceUsdBeforeRounding: number;
  /** Backward-compatible alias for the unrounded commercial price. */
  customerPriceUsd: number;
  credits: number;
  customerValueUsd: number;
  estimatedGrossProfitUsd: number;
  estimatedGrossMarginPct: number;
}

export interface ProviderChargeQuote extends CommercialCharge {
  provider: BillableProvider;
  model: string;
  operation: BillableOperation;
  billingUnit: BillingUnit;
  quantity: number;
  pricingVersion: string;
  sourceUrl: string;
  verifiedAt: string;
}

export class BillingSafetyError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "BillingSafetyError";
  }
}

export const DEFAULT_COMMERCIAL_PRICING_POLICY: CommercialPricingPolicy = {
  // One Vidora credit is one US cent of customer-facing value. Provider COGS,
  // reserves and target margin determine how many credits an operation costs.
  creditValueUsd: 0.01,
  targetGrossMarginPct: 0.35,
  providerSafetyBufferPct: 0.05,
  fxSafetyBufferPct: 0.05,
  // This is deliberately a configurable reserve, not a claim about Hubtel's
  // published merchant fee. It protects margin until the actual gateway fee is
  // set in Admin Billing Policy.
  gatewayFeeReservePct: 0.03,
  infrastructureReservePct: 0.03,
  minimumChargeCredits: 1,
  priceMaxAgeHours: 1080,
  quoteTtlMinutes: 15,
  billingEnabled: true,
};

const DEFAULT_POLICY = DEFAULT_COMMERCIAL_PRICING_POLICY;

interface PolicyRow {
  creditValueUsd: number;
  targetGrossMarginPct: number;
  providerSafetyBufferPct: number;
  fxSafetyBufferPct: number;
  gatewayFeeReservePct: number;
  infrastructureReservePct: number;
  minimumChargeCredits: number;
  priceMaxAgeHours: number;
  quoteTtlMinutes: number;
  billingEnabled: boolean;
}

interface PriceRow {
  provider: string;
  model: string;
  operation: string;
  billingUnit: string;
  unitPriceUsd: number;
  unitsPerPrice: number;
  sourceUrl: string;
  pricingVersion: string;
  verifiedAt: Date;
}

function finitePct(value: number, fallback: number, max = 0.9): number {
  return Number.isFinite(value) && value >= 0 && value <= max ? value : fallback;
}

export function normalizeBillingPolicy(row: Partial<PolicyRow> | null | undefined): CommercialPricingPolicy {
  if (!row) return { ...DEFAULT_POLICY };
  return {
    creditValueUsd: Number.isFinite(row.creditValueUsd) && Number(row.creditValueUsd) > 0
      ? Number(row.creditValueUsd)
      : DEFAULT_POLICY.creditValueUsd,
    targetGrossMarginPct: finitePct(Number(row.targetGrossMarginPct), DEFAULT_POLICY.targetGrossMarginPct, 0.8),
    providerSafetyBufferPct: finitePct(Number(row.providerSafetyBufferPct), DEFAULT_POLICY.providerSafetyBufferPct, 0.5),
    fxSafetyBufferPct: finitePct(Number(row.fxSafetyBufferPct), DEFAULT_POLICY.fxSafetyBufferPct, 0.5),
    gatewayFeeReservePct: finitePct(Number(row.gatewayFeeReservePct), DEFAULT_POLICY.gatewayFeeReservePct, 0.3),
    infrastructureReservePct: finitePct(Number(row.infrastructureReservePct), DEFAULT_POLICY.infrastructureReservePct, 0.5),
    minimumChargeCredits: Number.isSafeInteger(row.minimumChargeCredits) && Number(row.minimumChargeCredits) > 0
      ? Number(row.minimumChargeCredits)
      : DEFAULT_POLICY.minimumChargeCredits,
    priceMaxAgeHours: Number.isSafeInteger(row.priceMaxAgeHours) && Number(row.priceMaxAgeHours) > 0
      ? Number(row.priceMaxAgeHours)
      : DEFAULT_POLICY.priceMaxAgeHours,
    quoteTtlMinutes: Number.isSafeInteger(row.quoteTtlMinutes) && Number(row.quoteTtlMinutes) > 0
      ? Number(row.quoteTtlMinutes)
      : DEFAULT_POLICY.quoteTtlMinutes,
    billingEnabled: row.billingEnabled !== false,
  };
}

export async function getCommercialPricingPolicy(): Promise<CommercialPricingPolicy> {
  try {
    const rows = await db.$queryRaw<PolicyRow[]>`
      SELECT
        "creditValueUsd",
        "targetGrossMarginPct",
        "providerSafetyBufferPct",
        "fxSafetyBufferPct",
        "gatewayFeeReservePct",
        "infrastructureReservePct",
        "minimumChargeCredits",
        "priceMaxAgeHours",
        "quoteTtlMinutes",
        "billingEnabled"
      FROM "CommercialPricingPolicy"
      WHERE "id" = 'default'
      LIMIT 1
    `;
    return normalizeBillingPolicy(rows[0]);
  } catch (error) {
    // Fail closed in production if the billing migration is unexpectedly absent.
    if (process.env.NODE_ENV === "production") {
      throw new BillingSafetyError(
        "BILLING_POLICY_UNAVAILABLE",
        `Billing policy is unavailable: ${error instanceof Error ? error.message : "database error"}`,
      );
    }
    return { ...DEFAULT_POLICY };
  }
}

export function calculateCommercialCharge(
  providerCostUsd: number,
  policy: CommercialPricingPolicy,
): CommercialCharge {
  if (!policy.billingEnabled) {
    throw new BillingSafetyError("BILLING_DISABLED", "Paid AI generation is temporarily disabled by billing policy.");
  }
  if (!Number.isFinite(providerCostUsd) || providerCostUsd < 0) {
    throw new BillingSafetyError("INVALID_PROVIDER_COST", "Provider cost is invalid.");
  }
  const providerSafetyUsd = providerCostUsd * policy.providerSafetyBufferPct;
  const fxReserveUsd = providerCostUsd * policy.fxSafetyBufferPct;
  const infrastructureReserveUsd = providerCostUsd * policy.infrastructureReservePct;
  const base = providerCostUsd + providerSafetyUsd + fxReserveUsd + infrastructureReserveUsd;

  // Both target margin and payment-gateway reserve are percentages of the sale
  // price. Solve price = base / (1 - margin - gateway reserve), rather than
  // simply adding percentages to cost and accidentally shrinking the margin.
  const denominator = 1 - policy.targetGrossMarginPct - policy.gatewayFeeReservePct;
  if (denominator <= 0.05) {
    throw new BillingSafetyError("UNSAFE_MARGIN_POLICY", "Margin and gateway reserve leave no safe customer price.");
  }
  const rawCustomerPriceUsd = base / denominator;
  const credits = Math.max(
    policy.minimumChargeCredits,
    Math.ceil((rawCustomerPriceUsd - Number.EPSILON) / policy.creditValueUsd),
  );
  const customerValueUsd = credits * policy.creditValueUsd;
  const gatewayFeeReserveUsd = customerValueUsd * policy.gatewayFeeReservePct;
  const bufferedCostUsd = base + gatewayFeeReserveUsd;
  const estimatedGrossProfitUsd = customerValueUsd - bufferedCostUsd;
  const estimatedGrossMarginPct = customerValueUsd > 0
    ? estimatedGrossProfitUsd / customerValueUsd
    : 0;

  return {
    providerCostUsd,
    providerSafetyUsd,
    fxReserveUsd,
    infrastructureReserveUsd,
    gatewayFeeReserveUsd,
    bufferedCostUsd,
    customerPriceUsdBeforeRounding: rawCustomerPriceUsd,
    customerPriceUsd: rawCustomerPriceUsd,
    credits,
    customerValueUsd,
    estimatedGrossProfitUsd,
    estimatedGrossMarginPct,
  };
}

function asProvider(value: string): BillableProvider | null {
  return value === "zai" || value === "qwen" ? value : null;
}

function asOperation(value: string): BillableOperation | null {
  return new Set<BillableOperation>([
    "video_generation",
    "image_generation",
    "tts",
    "text_input",
    "text_output",
    "vision_input",
    "vision_output",
    "asr",
  ]).has(value as BillableOperation)
    ? value as BillableOperation
    : null;
}

function asUnit(value: string): BillingUnit | null {
  return new Set<BillingUnit>(["request", "image", "character", "token", "minute"]).has(value as BillingUnit)
    ? value as BillingUnit
    : null;
}

export async function getProviderPrice(
  provider: BillableProvider,
  model: string,
  operation: BillableOperation,
  policy?: CommercialPricingPolicy,
): Promise<ProviderPriceSnapshot> {
  const currentPolicy = policy ?? await getCommercialPricingPolicy();
  const rows = await db.$queryRaw<PriceRow[]>`
    SELECT
      "provider", "model", "operation", "billingUnit", "unitPriceUsd",
      "unitsPerPrice", "sourceUrl", "pricingVersion", "verifiedAt"
    FROM "ProviderPrice"
    WHERE "provider" = ${provider}
      AND "model" = ${model}
      AND "operation" = ${operation}
      AND "active" = TRUE
      AND "effectiveFrom" <= CURRENT_TIMESTAMP
      AND ("effectiveUntil" IS NULL OR "effectiveUntil" > CURRENT_TIMESTAMP)
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    throw new BillingSafetyError(
      "UNKNOWN_PROVIDER_PRICE",
      `No verified price exists for ${provider}/${model}/${operation}; paid generation is blocked to prevent an unpriced API call.`,
    );
  }
  const normalizedProvider = asProvider(row.provider);
  const normalizedOperation = asOperation(row.operation);
  const normalizedUnit = asUnit(row.billingUnit);
  if (!normalizedProvider || !normalizedOperation || !normalizedUnit || row.unitPriceUsd < 0 || row.unitsPerPrice <= 0) {
    throw new BillingSafetyError("INVALID_PROVIDER_PRICE", `Provider price for ${provider}/${model} is malformed.`);
  }
  const ageHours = (Date.now() - new Date(row.verifiedAt).getTime()) / 3_600_000;
  if (!Number.isFinite(ageHours) || ageHours < -24 || ageHours > currentPolicy.priceMaxAgeHours) {
    throw new BillingSafetyError(
      "STALE_PROVIDER_PRICE",
      `Verified provider price for ${provider}/${model} is stale; re-verify pricing before accepting paid generation.`,
    );
  }
  return {
    provider: normalizedProvider,
    model: row.model,
    operation: normalizedOperation,
    billingUnit: normalizedUnit,
    unitPriceUsd: Number(row.unitPriceUsd),
    unitsPerPrice: Number(row.unitsPerPrice),
    sourceUrl: row.sourceUrl,
    pricingVersion: row.pricingVersion,
    verifiedAt: new Date(row.verifiedAt),
  };
}

export async function quoteProviderCharge(opts: {
  provider: BillableProvider;
  model: string;
  operation: BillableOperation;
  quantity?: number;
  policy?: CommercialPricingPolicy;
}): Promise<ProviderChargeQuote> {
  const policy = opts.policy ?? await getCommercialPricingPolicy();
  const quantity = Number(opts.quantity ?? 1);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new BillingSafetyError("INVALID_BILLING_QUANTITY", "Provider billing quantity must be positive.");
  }
  const price = await getProviderPrice(opts.provider, opts.model, opts.operation, policy);
  const providerCostUsd = (quantity / price.unitsPerPrice) * price.unitPriceUsd;
  const charge = calculateCommercialCharge(providerCostUsd, policy);
  return {
    ...charge,
    provider: price.provider,
    model: price.model,
    operation: price.operation,
    billingUnit: price.billingUnit,
    quantity,
    pricingVersion: price.pricingVersion,
    sourceUrl: price.sourceUrl,
    verifiedAt: price.verifiedAt.toISOString(),
  };
}

export async function listProviderPrices(): Promise<ProviderPriceSnapshot[]> {
  const rows = await db.$queryRaw<PriceRow[]>`
    SELECT
      "provider", "model", "operation", "billingUnit", "unitPriceUsd",
      "unitsPerPrice", "sourceUrl", "pricingVersion", "verifiedAt"
    FROM "ProviderPrice"
    WHERE "active" = TRUE
    ORDER BY "provider", "operation", "model"
  `;
  return rows.flatMap((row) => {
    const provider = asProvider(row.provider);
    const operation = asOperation(row.operation);
    const billingUnit = asUnit(row.billingUnit);
    return provider && operation && billingUnit ? [{
      provider,
      model: row.model,
      operation,
      billingUnit,
      unitPriceUsd: Number(row.unitPriceUsd),
      unitsPerPrice: Number(row.unitsPerPrice),
      sourceUrl: row.sourceUrl,
      pricingVersion: row.pricingVersion,
      verifiedAt: new Date(row.verifiedAt),
    }] : [];
  });
}
