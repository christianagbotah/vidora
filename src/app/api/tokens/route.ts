import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/project-auth";

/**
 * GET /api/tokens
 * Returns the current authenticated user's balance and recent ledger entries.
 * Account state/sessionVersion is revalidated against PostgreSQL by requireAuth().
 */
export async function GET() {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const user = await db.user.findUnique({
      where: { id: auth.session.userId },
      select: { tokens: true },
    });
    if (!user) {
      return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
    }

    const recentTransactions = await db.tokenTransaction.findMany({
      where: { userId: auth.session.userId },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    return NextResponse.json({
      success: true,
      tokens: user.tokens,
      recentTransactions,
    });
  } catch (error) {
    console.error("Token fetch error:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ success: false, error: "Failed to fetch tokens" }, { status: 500 });
  }
}

/**
 * Direct client-controlled token spending is intentionally disabled.
 * Every spend must originate from a concrete server-side operation and pass
 * through deductTokensForOperation(), which supplies authoritative pricing,
 * row locking, a non-negative balance guard, and an idempotency key.
 */
export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      success: false,
      error: "Direct token spending is not supported. Use the relevant operation endpoint.",
    },
    {
      status: 405,
      headers: { Allow: "GET" },
    }
  );
}
