import { describe, expect, test } from "bun:test";
import { calculateCommercialCharge, type CommercialPricingPolicy } from "@/lib/provider-cost-billing";
import { calculateCreditPackageEconomics } from "@/lib/package-billing-safety";

const policy: CommercialPricingPolicy = {
  creditValueUsd: 0.01,
  targetGrossMarginPct: 0.35,
  providerSafetyBufferPct: 0.05,
  fxSafetyBufferPct: 0.05,
  gatewayFeeReservePct: 0.03,
  infrastructureReservePct: 0.03,
  minimumChargeCredits: 1,
  priceMaxAgeHours: 1080,
  quoteTtlMinutes: 15,
  billingEnabled: true,
};

describe("provider-cost-backed commercial pricing", () => {
  test("customer charge covers buffered COGS and configured margin", () => {
    const charge = calculateCommercialCharge(0.20, policy);
    expect(charge.credits).toBeGreaterThan(20);
    expect(charge.customerValueUsd).toBeGreaterThan(charge.bufferedCostUsd);
    expect(charge.estimatedGrossMarginPct).toBeGreaterThanOrEqual(policy.targetGrossMarginPct - 0.02);
  });

  test("rounds upward to whole credits instead of undercharging", () => {
    const charge = calculateCommercialCharge(0.115 / 10_000 * 563, policy);
    expect(charge.credits).toBe(Math.ceil(charge.customerPriceUsd / policy.creditValueUsd));
    expect(charge.customerValueUsd).toBeGreaterThanOrEqual(charge.customerPriceUsd);
  });

  test("unsafe margin policy fails closed", () => {
    expect(() => calculateCommercialCharge(0.20, {
      ...policy,
      targetGrossMarginPct: 0.95,
      gatewayFeeReservePct: 0.10,
    })).toThrow();
  });
});

describe("credit package economic floor", () => {
  test("bonus credits are included in minimum package value", () => {
    const economics = calculateCreditPackageEconomics({
      baseCredits: 100,
      bonusPct: 20,
      ghsPerUsd: 12.5,
      policy,
    });
    expect(economics.effectiveCredits).toBe(120);
    expect(economics.minimumPriceUsd).toBeCloseTo(1.20, 8);
    expect(economics.minimumPriceGhs).toBeCloseTo(15, 8);
  });
});
