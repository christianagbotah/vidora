import { db } from "@/lib/db";
import { BillingSafetyError, getCommercialPricingPolicy, type CommercialPricingPolicy } from "@/lib/provider-cost-billing";

export interface CreditPackageEconomics {
  effectiveCredits: number;
  minimumPriceUsd: number;
  minimumPriceGhs: number;
  ghsPerUsd: number;
}

export interface SafeCreditPackageCheckoutPrice extends CreditPackageEconomics {
  configuredPriceUsd: number;
  configuredPriceGhs: number;
  checkoutPriceUsd: number;
  checkoutPriceGhs: number;
  repricedUsd: boolean;
  repricedGhs: boolean;
}

function ceilCurrency(value: number): number {
  return Math.ceil((value * 100) - 1e-9) / 100;
}

export function calculateCreditPackageEconomics(opts: {
  baseCredits: number;
  bonusPct: number;
  ghsPerUsd: number;
  policy: CommercialPricingPolicy;
}): CreditPackageEconomics {
  const base = Math.floor(Number(opts.baseCredits));
  const bonusPct = Number(opts.bonusPct);
  const ghsPerUsd = Number(opts.ghsPerUsd);
  if (!Number.isSafeInteger(base) || base <= 0) throw new BillingSafetyError("INVALID_PACKAGE_CREDITS", "Package credits must be a positive integer.");
  if (!Number.isFinite(bonusPct) || bonusPct < 0 || bonusPct > 100) throw new BillingSafetyError("INVALID_PACKAGE_BONUS", "Package bonus must be between 0% and 100%.");
  if (!Number.isFinite(ghsPerUsd) || ghsPerUsd <= 0) throw new BillingSafetyError("FX_RATE_UNAVAILABLE", "A verified GHS/USD exchange rate is required before selling credits.");
  const effectiveCredits = base + Math.round((base * bonusPct) / 100);
  const minimumPriceUsd = effectiveCredits * opts.policy.creditValueUsd;
  return {
    effectiveCredits,
    minimumPriceUsd,
    minimumPriceGhs: minimumPriceUsd * ghsPerUsd,
    ghsPerUsd,
  };
}

export function calculateSafeCreditPackageCheckoutPrice(opts: {
  baseCredits: number;
  bonusPct: number;
  configuredPriceUsd: number;
  configuredPriceGhs: number;
  ghsPerUsd: number;
  policy: CommercialPricingPolicy;
}): SafeCreditPackageCheckoutPrice {
  if (!opts.policy.billingEnabled) {
    throw new BillingSafetyError("BILLING_DISABLED", "Credit purchases are disabled while provider billing is paused.");
  }
  const economics = calculateCreditPackageEconomics(opts);
  const configuredPriceUsd = Number(opts.configuredPriceUsd);
  const configuredPriceGhs = Number(opts.configuredPriceGhs);
  if (!Number.isFinite(configuredPriceUsd) || configuredPriceUsd < 0) {
    throw new BillingSafetyError("INVALID_PACKAGE_PRICE_USD", "Package USD price is invalid.");
  }
  if (!Number.isFinite(configuredPriceGhs) || configuredPriceGhs < 0) {
    throw new BillingSafetyError("INVALID_PACKAGE_PRICE_GHS", "Package GHS price is invalid.");
  }
  const floorUsd = ceilCurrency(economics.minimumPriceUsd);
  const floorGhs = ceilCurrency(economics.minimumPriceGhs);
  const checkoutPriceUsd = Math.max(ceilCurrency(configuredPriceUsd), floorUsd);
  const checkoutPriceGhs = Math.max(ceilCurrency(configuredPriceGhs), floorGhs);
  return {
    ...economics,
    configuredPriceUsd,
    configuredPriceGhs,
    checkoutPriceUsd,
    checkoutPriceGhs,
    repricedUsd: checkoutPriceUsd > configuredPriceUsd + 1e-9,
    repricedGhs: checkoutPriceGhs > configuredPriceGhs + 1e-9,
  };
}

export async function getBillingGhsPerUsd(): Promise<number> {
  const row = await db.systemConfig.findUnique({ where: { key: "exchange_rate_ghs_usd" } });
  const value = Number(row?.value);
  if (!Number.isFinite(value) || value <= 0) {
    throw new BillingSafetyError(
      "FX_RATE_UNAVAILABLE",
      "GHS/USD exchange rate is missing or invalid. Refresh it in Admin before accepting Hubtel credit purchases.",
    );
  }
  return value;
}

export async function getSafeCreditPackageCheckoutPrice(opts: {
  baseCredits: number;
  bonusPct: number;
  configuredPriceUsd: number;
  configuredPriceGhs: number;
}): Promise<SafeCreditPackageCheckoutPrice> {
  const [policy, ghsPerUsd] = await Promise.all([
    getCommercialPricingPolicy(),
    getBillingGhsPerUsd(),
  ]);
  return calculateSafeCreditPackageCheckoutPrice({ ...opts, policy, ghsPerUsd });
}

export async function assertCreditPackageIsEconomicallySafe(opts: {
  baseCredits: number;
  bonusPct: number;
  priceUsd: number;
  priceGhs: number;
}): Promise<CreditPackageEconomics> {
  const safe = await getSafeCreditPackageCheckoutPrice({
    baseCredits: opts.baseCredits,
    bonusPct: opts.bonusPct,
    configuredPriceUsd: opts.priceUsd,
    configuredPriceGhs: opts.priceGhs,
  });
  if (safe.repricedUsd) {
    throw new BillingSafetyError(
      "PACKAGE_UNDERPRICED_USD",
      `Package would sell ${safe.effectiveCredits} credits below their $${safe.minimumPriceUsd.toFixed(2)} minimum value.`,
    );
  }
  if (safe.repricedGhs) {
    throw new BillingSafetyError(
      "PACKAGE_UNDERPRICED_GHS",
      `Package would sell ${safe.effectiveCredits} credits below their GH₵${safe.minimumPriceGhs.toFixed(2)} minimum value at the current exchange rate.`,
    );
  }
  return {
    effectiveCredits: safe.effectiveCredits,
    minimumPriceUsd: safe.minimumPriceUsd,
    minimumPriceGhs: safe.minimumPriceGhs,
    ghsPerUsd: safe.ghsPerUsd,
  };
}
