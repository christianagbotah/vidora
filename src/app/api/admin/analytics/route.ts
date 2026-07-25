import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  try {
    const [
      totalUsers,
      activeUsers,
      totalProjects,
      totalPayments,
      revenueResult,
      tokensSoldResult,
      recentUsers,
      recentPayments,
    ] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { isActive: true } }),
      db.videoProject.count(),
      db.payment.count({ where: { status: "completed" } }),
      db.payment.aggregate({ where: { status: "completed" }, _sum: { amount: true } }),
      db.payment.aggregate({ where: { status: "completed" }, _sum: { tokensPurchased: true } }),
      db.user.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { id: true, email: true, name: true, role: true, createdAt: true } }),
      db.payment.findMany({
        where: { status: "completed" },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { user: { select: { email: true, name: true } } },
      }),
    ]);

    return NextResponse.json({
      success: true,
      analytics: {
        users: {
          total: totalUsers,
          active: activeUsers,
        },
        projects: {
          total: totalProjects,
        },
        revenue: {
          totalPayments,
          totalRevenue: revenueResult._sum.amount || 0,
          totalTokensSold: tokensSoldResult._sum.tokensPurchased || 0,
        },
        recentUsers,
        recentPayments,
      },
    });
  } catch (error) {
    console.error("Admin analytics error:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch analytics" }, { status: 500 });
  }
}
