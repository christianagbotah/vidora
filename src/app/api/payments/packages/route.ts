import { NextResponse } from "next/server";
import {
  calculateProjectCost,
  estimateSceneCount,
} from "@/lib/pricing";
import { getActivePackages } from "@/lib/token-packages";
import { getChargeCurrency } from "@/lib/storefront";
import { calculateSafeCreditPackageCheckoutPrice, getBillingGhsPerUsd } from "@/lib/package-billing-safety";
import { getCommercialPricingPolicy } from "@/lib/provider-cost-billing";

/**
 * Returns purchasable credit packages plus non-binding planning estimates.
 *
 * Billing v2 reprices an active package upward when its stored price no longer
 * covers all base + bonus credits at the current policy/FX rate. The same
 * helper is used again at payment initialization, so the customer-visible
 * amount and the gateway amount cannot drift below the live economic floor.
 * The authoritative generation amount is always the project-specific cost
 * quote shown immediately before paid generation starts.
 */
export async function GET() {
  try {
    const [packages, currency, policy, ghsPerUsd] = await Promise.all([
      getActivePackages(),
      getChargeCurrency(),
      getCommercialPricingPolicy(),
      getBillingGhsPerUsd(),
    ]);

    const packagesWithEstimates = packages.map((pkg) => {
      const safe = calculateSafeCreditPackageCheckoutPrice({
        baseCredits: pkg.tokens,
        bonusPct: pkg.bonusPct,
        configuredPriceUsd: pkg.priceUSD,
        configuredPriceGhs: pkg.priceGHS,
        ghsPerUsd,
        policy,
      });
      const oneMinVideoCost = calculateProjectCost(6, {
        withNarration: true,
      }).totalTokens;
      const videosYouCanMake = Math.floor(pkg.effectiveTokens / oneMinVideoCost);

      return {
        ...pkg,
        configuredPriceUSD: pkg.priceUSD,
        configuredPriceGHS: pkg.priceGHS,
        priceUSD: safe.checkoutPriceUsd,
        priceGHS: safe.checkoutPriceGhs,
        priceAdjustedForSafety: safe.repricedUsd || safe.repricedGhs,
        minimumPriceUSD: safe.minimumPriceUsd,
        minimumPriceGHS: safe.minimumPriceGhs,
        estimatedVideos: videosYouCanMake,
        perVideoCostGHS:
          videosYouCanMake > 0
            ? (safe.checkoutPriceGhs / videosYouCanMake).toFixed(2)
            : null,
      };
    });

    return NextResponse.json({
      success: true,
      currency,
      packages: packagesWithEstimates,
      pricing: {
        creditValueUSD: policy.creditValueUsd,
        creditValueGHS: policy.creditValueUsd * ghsPerUsd,
        ghsPerUsd,
        authoritativeQuoteRequired: true,
        samplesAreEstimates: true,
        livePackageSafetyFloor: true,
        samples: [
          {
            label: "30-second video (3 scenes)",
            cost: calculateProjectCost(3, { withNarration: true }),
          },
          {
            label: "1-minute video (6 scenes)",
            cost: calculateProjectCost(6, { withNarration: true }),
          },
          {
            label: "2-minute video (12 scenes)",
            cost: calculateProjectCost(12, {
              withNarration: true,
              withContinuityCheck: true,
            }),
          },
          {
            label: "5-minute video (30 scenes)",
            cost: calculateProjectCost(30, {
              withNarration: true,
              withContinuityCheck: true,
            }),
          },
        ],
      },
    });
  } catch (error) {
    console.error(
      "[payments/packages] billing-safe storefront unavailable:",
      error instanceof Error ? error.message : "unknown error",
    );
    return NextResponse.json({
      success: false,
      error: "Credit packages are temporarily unavailable while billing rates are being verified.",
      packages: [],
    }, { status: 503 });
  }
}

// Helper re-exported for backward compatibility with existing callers.
export { estimateSceneCount };
