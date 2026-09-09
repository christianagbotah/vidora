import { db } from "@/lib/db";

/**
 * Vidora billing economics.
 *
 * Users buy Vidora credits from Vidora. Upstream providers (Z.ai/Qwen/etc.)
 * remain merchant COGS and are never funded directly by an end-user payment.
 * Every billable provider operation must reserve enough Vidora credits to
 * cover provider COGS, a provider-risk allowance, payment costs, and the
 * configured target gross margin.
 */

export const DEFAULT_TOKEN_VALUE_USD = 0.05;
export const QWEN3_TTS_INSTRUCT_FLASH_USD_PER_10K_CHARACTERS = 0.115;

export const BILLING_CONFIG_KEYS = {
  tokenValueUsd: "billing.token_value_usd",
  targetMarginPct: "billing.target_margin_pct",
  providerRiskBufferPct: "billing.provider_risk_buffer_pct",
  paymentFeeBufferPct: "billing.payment_fee_buffer_pct",
  fxBufferPct: "billing.fx_buffer_pct",
} as const;

export interface BillingPolicy {
  /** Gross sales value represented by one Vidora credit. */
  tokenValueUsd: number;
  /** Desired gross margin after provider COGS and payment-fee allowance. */
  targetMarginPct: number;
  /** Extra COGS reserve for retries/provider pricing drift. */
  providerRiskBufferPct: number;
  /** Allowance for collection/payment processing costs. */
  paymentFeeBufferPct: number;
  /** Extra GHS allowance against FX movement between pricing and settlement. */
  fxBufferPct: number;
}

export const DEFAULT_BILLING_POLICY: BillingPolicy = {
  tokenValueUsd: DEFAULT_TOKEN_VALUE_USD,
  targetMarginPct: 30,
  providerRiskBufferPct: 5,
  paymentFeeBufferPct: 3,
  fxBufferPct: 3,
};

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizedPolicy(input: Partial<BillingPolicy>): BillingPolicy {
  const targetMarginPct = clamp(
    finiteNumber(input.targetMarginPct, DEFAULT_BILLING_POLICY.targetMarginPct),
    0,
    80,
  );
  const paymentFeeBufferPct = clamp(
    finiteNumber(input.paymentFeeBufferPct, DEFAULT_BILLING_POLICY.paymentFeeBufferPct),
    0,
    25,
  );

  // Keep a positive revenue denominator even if an admin enters extreme
  // values. This is deliberately conservative rather than allowing a quote
  // that can never cover its costs.
  const safeMarginPct = Math.min(targetMarginPct, 90 - paymentFeeBufferPct);

  return {
    tokenValueUsd: clamp(
      finiteNumber(input.tokenValueUsd, DEFAULT_BILLING_POLICY.tokenValueUsd),
      0.01,
      10,
    ),
    targetMarginPct: safeMarginPct,
    providerRiskBufferPct: clamp(
      finiteNumber(input.providerRiskBufferPct, DEFAULT_BILLING_POLICY.providerRiskBufferPct),
      0,
      50,
    ),
    paymentFeeBufferPct,
    fxBufferPct: clamp(
      finiteNumber(input.fxBufferPct, DEFAULT_BILLING_POLICY.fxBufferPct),
      0,
      25,
    ),
  };
}

export async function getBillingPolicy(): Promise<BillingPolicy> {
  try {
    const rows = await db.systemConfig.findMany({
      where: { key: { in: Object.values(BILLING_CONFIG_KEYS) } },
      select: { key: true, value: true },
    });
    const values = new Map(rows.map((row) => [row.key, row.value]));
    return normalizedPolicy({
      tokenValueUsd: finiteNumber(
        values.get(BILLING_CONFIG_KEYS.tokenValueUsd),
        DEFAULT_BILLING_POLICY.tokenValueUsd,
      ),
      targetMarginPct: finiteNumber(
        values.get(BILLING_CONFIG_KEYS.targetMarginPct),
        DEFAULT_BILLING_POLICY.targetMarginPct,
      ),
      providerRiskBufferPct: finiteNumber(
        values.get(BILLING_CONFIG_KEYS.providerRiskBufferPct),
        DEFAULT_BILLING_POLICY.providerRiskBufferPct,
      ),
      paymentFeeBufferPct: finiteNumber(
        values.get(BILLING_CONFIG_KEYS.paymentFeeBufferPct),
        DEFAULT_BILLING_POLICY.paymentFeeBufferPct,
      ),
      fxBufferPct: finiteNumber(
        values.get(BILLING_CONFIG_KEYS.fxBufferPct),
        DEFAULT_BILLING_POLICY.fxBufferPct,
      ),
    });
  } catch (error) {
    console.error("[billing] policy read failed; using conservative defaults:", error);
    return DEFAULT_BILLING_POLICY;
  }
}

export interface ProviderCostQuote {
  providerCostUsd: number;
  riskAdjustedProviderCostUsd: number;
  minimumRevenueUsd: number;
  requiredTokens: number;
  tokenValueUsd: number;
  targetMarginPct: number;
  providerRiskBufferPct: number;
  paymentFeeBufferPct: number;
}

/**
 * Convert upstream COGS into a minimum Vidora-credit charge.
 *
 * revenue * (1 - paymentFee - targetMargin) >= providerCost * (1 + risk)
 */
export function quoteProviderCost(
  providerCostUsd: number,
  policy: BillingPolicy = DEFAULT_BILLING_POLICY,
): ProviderCostQuote {
  const safePolicy = normalizedPolicy(policy);
  const cost = Math.max(0, finiteNumber(providerCostUsd, 0));
  if (cost === 0) {
    return {
      providerCostUsd: 0,
      riskAdjustedProviderCostUsd: 0,
      minimumRevenueUsd: 0,
      requiredTokens: 0,
      tokenValueUsd: safePolicy.tokenValueUsd,
      targetMarginPct: safePolicy.targetMarginPct,
      providerRiskBufferPct: safePolicy.providerRiskBufferPct,
      paymentFeeBufferPct: safePolicy.paymentFeeBufferPct,
    };
  }

  const riskAdjustedProviderCostUsd = cost * (1 + safePolicy.providerRiskBufferPct / 100);
  const revenueShare = Math.max(
    0.1,
    1 - safePolicy.paymentFeeBufferPct / 100 - safePolicy.targetMarginPct / 100,
  );
  const minimumRevenueUsd = riskAdjustedProviderCostUsd / revenueShare;
  const requiredTokens = Math.max(
    1,
    Math.ceil((minimumRevenueUsd - Number.EPSILON) / safePolicy.tokenValueUsd),
  );

  return {
    providerCostUsd: cost,
    riskAdjustedProviderCostUsd,
    minimumRevenueUsd,
    requiredTokens,
    tokenValueUsd: safePolicy.tokenValueUsd,
    targetMarginPct: safePolicy.targetMarginPct,
    providerRiskBufferPct: safePolicy.providerRiskBufferPct,
    paymentFeeBufferPct: safePolicy.paymentFeeBufferPct,
  };
}

export async function minimumTokensForProviderCost(providerCostUsd: number): Promise<number> {
  return quoteProviderCost(providerCostUsd, await getBillingPolicy()).requiredTokens;
}

/** Enforce an admin-configured charge without ever allowing it below COGS floor. */
export async function protectConfiguredTokenCharge(
  configuredTokens: number,
  providerCostUsd: number,
): Promise<{ tokens: number; floorTokens: number; quote: ProviderCostQuote }> {
  const policy = await getBillingPolicy();
  const quote = quoteProviderCost(providerCostUsd, policy);
  const configured = Math.max(0, Math.floor(finiteNumber(configuredTokens, 0)));
  return {
    tokens: Math.max(configured, quote.requiredTokens),
    floorTokens: quote.requiredTokens,
    quote,
  };
}

export function qwenBillableCharacterCount(text: string): number {
  // Unicode code points are a safer approximation of provider-visible
  // characters than UTF-16 code units. The provider's returned usage remains
  // authoritative after a successful call.
  return Array.from(text).length;
}

export function qwenTtsCostUsd(characters: number): number {
  const quantity = Math.max(0, Math.floor(finiteNumber(characters, 0)));
  return (quantity / 10_000) * QWEN3_TTS_INSTRUCT_FLASH_USD_PER_10K_CHARACTERS;
}

export async function quoteQwenTtsCharacters(characters: number): Promise<ProviderCostQuote> {
  return quoteProviderCost(qwenTtsCostUsd(characters), await getBillingPolicy());
}

/**
 * Persisted FX is populated by the exchange-rate service. A high fallback is
 * intentionally conservative: stale/missing FX must never make GHS checkout
 * cheaper than the USD liability it funds.
 */
export async function getPricingGhsPerUsd(): Promise<number> {
  try {
    const row = await db.systemConfig.findUnique({
      where: { key: "exchange_rate_ghs_usd" },
      select: { value: true },
    });
    const rate = finiteNumber(row?.value, 15);
    return rate > 0 ? rate : 15;
  } catch {
    return 15;
  }
}

function ceilCurrency(value: number): number {
  return Math.ceil((value - Number.EPSILON) * 100) / 100;
}

export interface ProtectedPackagePrices {
  priceUSD: number;
  priceGHS: number;
  floorUSD: number;
  floorGHS: number;
  adjustedUSD: boolean;
  adjustedGHS: boolean;
  effectiveTokens: number;
}

/**
 * Ensure token bundles—including bonus credits—never sell credits below the
 * USD face value used by provider quotes. GHS gets an additional FX buffer.
 */
export async function protectTokenPackagePrices(opts: {
  baseTokens: number;
  bonusPct: number;
  configuredPriceUSD: number;
  configuredPriceGHS: number;
}): Promise<ProtectedPackagePrices> {
  const policy = await getBillingPolicy();
  const ghsPerUsd = await getPricingGhsPerUsd();
  const baseTokens = Math.max(1, Math.floor(finiteNumber(opts.baseTokens, 1)));
  const bonusPct = clamp(finiteNumber(opts.bonusPct, 0), 0, 100);
  const effectiveTokens = baseTokens + Math.round(baseTokens * bonusPct / 100);
  const floorUSD = ceilCurrency(effectiveTokens * policy.tokenValueUsd);
  const floorGHS = ceilCurrency(
    floorUSD * ghsPerUsd * (1 + policy.fxBufferPct / 100),
  );
  const configuredPriceUSD = Math.max(0, finiteNumber(opts.configuredPriceUSD, 0));
  const configuredPriceGHS = Math.max(0, finiteNumber(opts.configuredPriceGHS, 0));
  const priceUSD = Math.max(configuredPriceUSD, floorUSD);
  const priceGHS = Math.max(configuredPriceGHS, floorGHS);

  return {
    priceUSD,
    priceGHS,
    floorUSD,
    floorGHS,
    adjustedUSD: priceUSD > configuredPriceUSD + 1e-9,
    adjustedGHS: priceGHS > configuredPriceGHS + 1e-9,
    effectiveTokens,
  };
}
