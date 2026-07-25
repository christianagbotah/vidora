import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  try {
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const status = searchParams.get("status") || "";
    const gateway = searchParams.get("gateway") || "";

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (gateway) where.gateway = gateway;

    const payments = await db.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        user: {
          select: { id: true, email: true, name: true },
        },
      },
    });

    const total = await db.payment.count({ where });
    const revenue = await db.payment.aggregate({
      where: { status: "completed" },
      _sum: { amount: true },
    });
    const totalTokens = await db.payment.aggregate({
      where: { status: "completed" },
      _sum: { tokensPurchased: true },
    });

    return NextResponse.json({
      success: true,
      payments,
      stats: {
        totalRevenue: revenue._sum.amount || 0,
        totalTokensSold: totalTokens._sum.tokensPurchased || 0,
      },
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("Admin list payments error:", error);
    return NextResponse.json({ success: false, error: "Failed to list payments" }, { status: 500 });
  }
}
