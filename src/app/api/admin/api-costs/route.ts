import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { PRICING, TOKEN_VALUE_GHS, TOKEN_VALUE_USD, type OperationType, calculateProjectCost } from "@/lib/pricing";

/**
 * ── Admin z.ai API Cost Breakdown ──
 *
 * Returns:
 *  1. The pricing table (tokens charged + real USD cost per operation)
 *  2. Actual historical cost data from TokenTransaction records
 *  3. Project cost estimates for common video lengths
 *  4. Token valuation metrics
 *
 * This helps the admin understand exactly what each AI operation costs
 * via the Z.ai API and how that translates to user-facing token charges.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }
    const role = (session.user as Record<string, unknown>).role as string;
    if (role !== "admin") {
      return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
    }

    // ── 1. Pricing Table (from pricing.ts) ──
    const pricingTable = Object.entries(PRICING).map(([op, pricing]) => ({
      operation: op,
      label: pricing.label,
      tokensCharged: pricing.tokens,
      estimatedCostUsd: pricing.costUsd,
      marginTokens: pricing.tokens > 0
        ? pricing.costUsd / (pricing.tokens * TOKEN_VALUE_USD) * 100
        : pricing.costUsd > 0 ? -100 : 0, // % of revenue consumed by API cost
    }));

    // ── 2. Historical actual costs from DB ──
    const spendTxns = await db.tokenTransaction.findMany({
      where: { type: "spend", costUsd: { not: null } },
      select: {
        operationType: true,
        costUsd: true,
        amount: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });

    // Aggregate by operation type
    const historicalByOp: Record<string, { count: number; totalCostUsd: number; totalTokensSpent: number; avgCostUsd: number }> = {};
    for (const tx of spendTxns) {
      const op = tx.operationType || "unknown";
      if (!historicalByOp[op]) {
        historicalByOp[op] = { count: 0, totalCostUsd: 0, totalTokensSpent: 0, avgCostUsd: 0 };
      }
      historicalByOp[op].count += 1;
      historicalByOp[op].totalCostUsd += tx.costUsd || 0;
      historicalByOp[op].totalTokensSpent += Math.abs(tx.amount);
    }

    // Compute averages
    for (const op of Object.keys(historicalByOp)) {
      const data = historicalByOp[op];
      data.avgCostUsd = data.count > 0 ? Math.round((data.totalCostUsd / data.count) * 1000) / 1000 : 0;
    }

    // ── 3. Project Cost Estimates ──
    const projectEstimates = [
      { label: "30-sec video", scenes: 3 },
      { label: "1-min video", scenes: 6 },
      { label: "2-min video", scenes: 12 },
      { label: "3-min video", scenes: 18 },
    ].map(({ label, scenes }) => {
      const cost = calculateProjectCost(scenes, {
        withNarration: true,
        withContinuityCheck: true,
      });
      return {
        label,
        scenes,
        tokens: cost.totalTokens,
        zaiCostUsd: Math.round(cost.totalCostUsd * 100) / 100,
        revenueUsd: Math.round(cost.estimatedRevenueUsd * 100) / 100,
        profitUsd: Math.round(cost.estimatedProfitUsd * 100) / 100,
        marginPct: Math.round(cost.estimatedMarginPct),
      };
    });

    // ── 4. Overall token valuation ──
    const totalSpendCostUsd = spendTxns.reduce((sum, t) => sum + (t.costUsd || 0), 0);
    const totalSpendTokens = spendTxns.reduce((sum, t) => sum + Math.abs(t.amount), 0);

    return NextResponse.json({
      success: true,
      data: {
        tokenValue: {
          perTokenGHS: TOKEN_VALUE_GHS,
          perTokenUSD: TOKEN_VALUE_USD,
        },
        pricingTable,
        historical: {
          totalOperations: spendTxns.length,
          totalCostUsd: Math.round(totalSpendCostUsd * 100) / 100,
          totalTokensSpent: totalSpendTokens,
          avgCostPerTokenUsd: totalSpendTokens > 0
            ? Math.round((totalSpendCostUsd / totalSpendTokens) * 10000) / 10000
            : 0,
          byOperation: historicalByOp,
        },
        projectEstimates,
      },
    });
  } catch (error) {
    console.error("API costs error:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch API costs" }, { status: 500 });
  }
}
