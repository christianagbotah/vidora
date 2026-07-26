import { NextResponse } from "next/server";
import {
  calculateProjectCost,
  estimateSceneCount,
} from "@/lib/pricing";
import { getActivePackages } from "@/lib/token-packages";

/**
 * Returns token packages available for purchase + a cost estimator
 * that the frontend uses to show users how much a video will cost.
 *
 * Packages are now DB-backed and admin-managed (see /api/admin/packages).
 * If the DB is unreachable, the service falls back to hardcoded defaults
 * in src/lib/pricing.ts so the storefront never breaks.
 */
export async function GET() {
  const packages = await getActivePackages();

  // Build a "what can I make with N tokens?" estimate for each package
  const packagesWithEstimates = packages.map((pkg) => {
    // A 1-min video (6 scenes, with narration) costs:
    const oneMinVideoCost = calculateProjectCost(6, {
      withNarration: true,
    }).totalTokens;
    const videosYouCanMake = Math.floor(
      pkg.effectiveTokens / oneMinVideoCost
    );

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
    packages: packagesWithEstimates,
    pricing: {
      tokenValueGHS: 0.5,
      tokenValueUSD: 0.05,
      // Sample video costs for the UI
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
}

// Helper re-exported for callers that want it (not used in this route, kept
// for backward compatibility with any code that imported it before).
export { estimateSceneCount };
