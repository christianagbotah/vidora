import { NextResponse } from "next/server";
import { getStorefrontData } from "@/lib/storefront";
import { getActivePackages } from "@/lib/token-packages";
import {
  calculateSafeCreditPackageCheckoutPrice,
  getBillingGhsPerUsd,
} from "@/lib/package-billing-safety";
import { getCommercialPricingPolicy } from "@/lib/provider-cost-billing";

/**
 * GET /api/storefront/pricing — PUBLIC
 *
 * Everything the storefront needs to render money-facing UI in one call:
 *   • currency — the admin-selected charge currency ("GHS" | "USD")
 *   • plans    — live Billing v2 credit packages, adapted to the homepage card shape
 *   • engines  — active video engines with per-clip prices + token costs
 *
 * Homepage package prices deliberately use the same live economic-floor helper
 * as /api/payments/packages and payment initialization. A stored legacy price
 * can therefore never make the landing page advertise less than checkout will
 * safely charge. Package/admin changes continue to flow through the existing
 * DB-backed package service without requiring a homepage redeploy.
 */
export async function GET() {
  try {
    const [data, packages, policy, ghsPerUsd] = await Promise.all([
      getStorefrontData(),
      getActivePackages(),
      getCommercialPricingPolicy(),
      getBillingGhsPerUsd(),
    ]);

    const plans = packages.map((pkg) => {
      const safe = calculateSafeCreditPackageCheckoutPrice({
        baseCredits: pkg.tokens,
        bonusPct: pkg.bonusPct,
        configuredPriceUsd: pkg.priceUSD,
        configuredPriceGhs: pkg.priceGHS,
        ghsPerUsd,
        policy,
      });
      const bonusCredits = Math.max(0, pkg.effectiveTokens - pkg.tokens);
      const packageFeatures = pkg.features.filter(
        (feature) => !/\b(?:token|tokens|credit|credits)\b/i.test(feature),
      );

      return {
        id: pkg.id,
        slug: pkg.slug,
        name: pkg.name,
        badge: pkg.popular
          ? "POPULAR"
          : pkg.bonusPct > 0
            ? `+${pkg.bonusPct}% BONUS`
            : "CREDITS",
        priceGHS: safe.checkoutPriceGhs,
        priceUSD: safe.checkoutPriceUsd,
        period: "one-time",
        features: [
          `${pkg.effectiveTokens} generation credits`,
          ...(bonusCredits > 0
            ? [`${bonusCredits} bonus credits included`]
            : []),
          ...packageFeatures,
          "One-time credit package",
        ],
        ctaLabel: "Buy Credits",
        ctaAction: "buy-tokens",
        highlight: pkg.popular,
        isActive: pkg.isActive,
        sortOrder: pkg.sortOrder,
        updatedAt: pkg.updatedAt,
      };
    });

    return NextResponse.json({
      success: true,
      currency: data.currency,
      plans,
      engines: data.engines,
    });
  } catch (err) {
    console.error("Storefront pricing read error:", err);
    return NextResponse.json(
      {
        success: false,
        error: "Pricing packages are temporarily unavailable while billing rates are being verified.",
      },
      { status: 503 },
    );
  }
}
