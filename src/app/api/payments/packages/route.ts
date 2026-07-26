import { NextResponse } from "next/server";
import { TOKEN_PACKAGES, getEffectiveTokens, calculateProjectCost, estimateSceneCount } from "@/lib/pricing";

/**
 * Returns token packages available for purchase + a cost estimator
 * that the frontend uses to show users how much a video will cost.
 */
export async function GET() {
  // Build a "what can I make with N tokens?" estimate for each package
  const packagesWithEstimates = TOKEN_PACKAGES.map((pkg) => {
    const effectiveTokens = getEffectiveTokens(pkg);
    // A 1-min video (6 scenes, with narration) costs:
    const oneMinVideoCost = calculateProjectCost(6, { withNarration: true }).totalTokens;
    const videosYouCanMake = Math.floor(effectiveTokens / oneMinVideoCost);

    return {
      ...pkg,
      effectiveTokens,
      estimatedVideos: videosYouCanMake,
      perVideoCostGHS: videosYouCanMake > 0 ? (pkg.priceGHS / videosYouCanMake).toFixed(2) : null,
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
          cost: calculateProjectCost(12, { withNarration: true, withContinuityCheck: true }),
        },
        {
          label: "5-minute video (30 scenes)",
          cost: calculateProjectCost(30, { withNarration: true, withContinuityCheck: true }),
        },
      ],
    },
  });
}
