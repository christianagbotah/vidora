import { db } from "@/lib/db";
import { BillingSafetyError, getCommercialPricingPolicy, type CommercialPricingPolicy } from "@/lib/provider-cost-billing";

export interface CreditPackageEconomics {
  effectiveCredits: number;
  minimumPriceUsd: number;
  minimumPriceGhs: number;
  ghsPerUsd: number;
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

export async function assertCreditPackageIsEconomicallySafe(opts: {
  baseCredits: number;
  bonusPct: number;
  priceUsd: number;
  priceGhs: number;
}): Promise<CreditPackageEconomics> {
  const [policy, ghsPerUsd] = await Promise.all([
    getCommercialPricingPolicy(),
    getBillingGhsPerUsd(),
  ]);
  if (!policy.billingEnabled) throw new BillingSafetyError("BILLING_DISABLED", "Credit purchases are disabled while provider billing is paused.");
  const economics = calculateCreditPackageEconomics({
    baseCredits: opts.baseCredits,
    bonusPct: opts.bonusPct,
    ghsPerUsd,
    policy,
  });
  const priceUsd = Number(opts.priceUsd);
  const priceGhs = Number(opts.priceGhs);
  if (!Number.isFinite(priceUsd) || priceUsd + 1e-9 < economics.minimumPriceUsd) {
    throw new BillingSafetyError(
      "PACKAGE_UNDERPRICED_USD",
      `Package would sell ${economics.effectiveCredits} credits below their $${economics.minimumPriceUsd.toFixed(2)} minimum value.`,
    );
  }
  if (!Number.isFinite(priceGhs) || priceGhs + 1e-9 < economics.minimumPriceGhs) {
    throw new BillingSafetyError(
      "PACKAGE_UNDERPRICED_GHS",
      `Package would sell ${economics.effectiveCredits} credits below their GH₵${economics.minimumPriceGhs.toFixed(2)} minimum value at the current exchange rate.`,
    );
  }
  return economics;
}
