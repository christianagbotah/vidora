import { NextResponse } from "next/server";
import {
  calculateProjectCost,
  estimateSceneCount,
} from "@/lib/pricing";
import { getActivePackages } from "@/lib/token-packages";
import { getChargeCurrency } from "@/lib/storefront";
import { assertCreditPackageIsEconomicallySafe, getBillingGhsPerUsd } from "@/lib/package-billing-safety";
import { getCommercialPricingPolicy } from "@/lib/provider-cost-billing";

/**
 * Returns purchaseable credit packages plus non-binding planning estimates.
 *
 * Billing v2 intentionally fails closed here: a package that no longer covers
 * the configured credit value at the current persisted GHS/USD rate is hidden
 * from customers until an admin repairs its price/bonus. The authoritative
 * generation amount is always the project-specific cost quote shown immediately
 * before paid generation starts.
 */
export async function GET() {
  try {
    const [packages, currency, policy, ghsPerUsd] = await Promise.all([
      getActivePackages(),
      getChargeCurrency(),
      getCommercialPricingPolicy(),
      getBillingGhsPerUsd(),
    ]);

    const safePackages = [] as typeof packages;
    for (const pkg of packages) {
      try {
        await assertCreditPackageIsEconomicallySafe({
          baseCredits: pkg.tokens,
          bonusPct: pkg.bonusPct,
          priceUsd: pkg.priceUSD,
          priceGhs: pkg.priceGHS,
        });
        safePackages.push(pkg);
      } catch (error) {
        console.warn(
          `[payments/packages] hiding economically unsafe package ${pkg.slug}:`,
          error instanceof Error ? error.message : "billing safety check failed",
        );
      }
    }

    const packagesWithEstimates = safePackages.map((pkg) => {
      const oneMinVideoCost = calculateProjectCost(6, {
        withNarration: true,
      }).totalTokens;
      const videosYouCanMake = Math.floor(pkg.effectiveTokens / oneMinVideoCost);

      return {
        ...pkg,
        estimatedVideos: videosYouCanMake,
        perVideoCostGHS:
          videosYouCanMake > 0
            ? (pkg.priceGHS / videosYouCanMake).toFixed(2)
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
