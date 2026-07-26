import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * ── Admin Profit Analytics ──
 *
 * This endpoint shows the business owner (you) the financial health of the app:
 *
 *  - REVENUE:  Total money users paid you (sum of completed Payments)
 *  - COGS:     Total Z.ai API costs (sum of TokenTransaction.costUsd)
 *  - GROSS PROFIT: Revenue - COGS
 *  - MARGIN:   Profit / Revenue × 100
 *
 *  Plus breakdowns by operation type (video_gen, image_gen, llm, etc.)
 *  and time-based trends (last 7/30 days).
 *
 *  Only accessible to admins.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }
    const role = (session.user as Record<string, unknown>).role as string;
    if (role !== "admin") {
      return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const period = searchParams.get("period") || "all"; // "7d" | "30d" | "all"

    // Build date filter
    const dateFilter: { gte?: Date } = {};
    const now = new Date();
    if (period === "7d") {
      dateFilter.gte = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === "30d") {
      dateFilter.gte = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const whereClause = period === "all" ? {} : { createdAt: dateFilter };

    // ── Revenue: sum of completed payments ──
    const payments = await db.payment.findMany({
      where: { ...whereClause, status: "completed" },
      select: { amount: true, currency: true, tokensPurchased: true, createdAt: true },
    });

    const revenueGHS = payments
      .filter((p) => p.currency === "GHS")
      .reduce((sum, p) => sum + p.amount, 0);
    const revenueUSD = payments
      .filter((p) => p.currency === "USD")
      .reduce((sum, p) => sum + p.amount, 0);
    const totalTokensSold = payments.reduce((sum, p) => sum + p.tokensPurchased, 0);
    const totalTransactions = payments.length;

    // ── COGS: sum of Z.ai API costs (from spend transactions) ──
    const spendTransactions = await db.tokenTransaction.findMany({
      where: { ...whereClause, type: "spend", costUsd: { not: null } },
      select: { costUsd: true, operationType: true, amount: true, createdAt: true },
    });

    const totalCogsUsd = spendTransactions.reduce((sum, t) => sum + (t.costUsd || 0), 0);
    const totalTokensSpent = spendTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);

    // ── Breakdown by operation type ──
    const breakdownByOp: Record<string, { count: number; costUsd: number; tokensSpent: number }> = {};
    for (const t of spendTransactions) {
      const op = t.operationType || "unknown";
      if (!breakdownByOp[op]) breakdownByOp[op] = { count: 0, costUsd: 0, tokensSpent: 0 };
      breakdownByOp[op].count += 1;
      breakdownByOp[op].costUsd += t.costUsd || 0;
      breakdownByOp[op].tokensSpent += Math.abs(t.amount);
    }

    // ── Refunds ──
    const refunds = await db.tokenTransaction.findMany({
      where: { ...whereClause, type: "refund" },
      select: { amount: true, description: true, createdAt: true },
    });
    const totalTokensRefunded = refunds.reduce((sum, r) => sum + r.amount, 0);

    // ── Calculate profit ──
    // Convert GHS revenue to USD (approx 1 GHS = 0.08 USD, adjust as needed)
    const GHS_TO_USD = 0.08;
    const totalRevenueUsd = revenueUSD + revenueGHS * GHS_TO_USD;
    const grossProfitUsd = totalRevenueUsd - totalCogsUsd;
    const marginPct = totalRevenueUsd > 0 ? (grossProfitUsd / totalRevenueUsd) * 100 : 0;

    // ── Daily trend (last 14 days) ──
    const trendDays: { date: string; revenueUsd: number; costUsd: number; profitUsd: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const dayStart = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

      const dayRevenue = payments
        .filter((p) => p.createdAt >= dayStart && p.createdAt < dayEnd)
        .reduce((sum, p) => sum + (p.currency === "USD" ? p.amount : p.amount * GHS_TO_USD), 0);

      const dayCost = spendTransactions
        .filter((t) => t.createdAt >= dayStart && t.createdAt < dayEnd)
        .reduce((sum, t) => sum + (t.costUsd || 0), 0);

      trendDays.push({
        date: dayStart.toISOString().slice(0, 10),
        revenueUsd: Math.round(dayRevenue * 100) / 100,
        costUsd: Math.round(dayCost * 100) / 100,
        profitUsd: Math.round((dayRevenue - dayCost) * 100) / 100,
      });
    }

    // ── Active users (users who spent tokens in this period) ──
    const activeUserIds = new Set(spendTransactions.map((_) => _.createdAt)); // placeholder
    // Actually query distinct users
    const activeSpenders = await db.tokenTransaction.findMany({
      where: { ...whereClause, type: "spend" },
      select: { userId: true },
      distinct: ["userId"],
    });

    return NextResponse.json({
      success: true,
      period,
      summary: {
        revenue: {
          ghs: Math.round(revenueGHS * 100) / 100,
          usd: Math.round(revenueUSD * 100) / 100,
          totalUsd: Math.round(totalRevenueUsd * 100) / 100,
        },
        tokensSold: totalTokensSold,
        tokensSpent: totalTokensSpent,
        tokensRefunded: totalTokensRefunded,
        cogsUsd: Math.round(totalCogsUsd * 100) / 100,
        grossProfitUsd: Math.round(grossProfitUsd * 100) / 100,
        marginPct: Math.round(marginPct * 100) / 100,
        totalTransactions,
        activeUsers: activeSpenders.length,
      },
      breakdownByOperation: Object.entries(breakdownByOp).map(([op, data]) => ({
        operation: op,
        count: data.count,
        costUsd: Math.round(data.costUsd * 100) / 100,
        tokensSpent: data.tokensSpent,
        avgCostPerOp: data.count > 0 ? Math.round((data.costUsd / data.count) * 1000) / 1000 : 0,
      })),
      trend: trendDays,
      refunds: {
        count: refunds.length,
        tokensRefunded: totalTokensRefunded,
        recent: refunds.slice(0, 10),
      },
    });
  } catch (error) {
    console.error("Profit analytics error:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch analytics" }, { status: 500 });
  }
}
