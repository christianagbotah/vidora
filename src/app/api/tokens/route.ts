import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const userId = (session.user as Record<string, unknown>).id as string;
    const user = await db.user.findUnique({ where: { id: userId } });

    if (!user) {
      return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
    }

    const recentTx = await db.tokenTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    return NextResponse.json({
      success: true,
      tokens: user.tokens,
      recentTransactions: recentTx,
    });
  } catch (error) {
    console.error("Token fetch error:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch tokens" }, { status: 500 });
  }
}

// Spend tokens (deduct from balance)
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const userId = (session.user as Record<string, unknown>).id as string;
    const body = await req.json();
    const { amount, description, referenceId } = body;

    if (!amount || amount <= 0) {
      return NextResponse.json({ success: false, error: "Invalid amount" }, { status: 400 });
    }

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
    }

    if (user.tokens < amount) {
      return NextResponse.json(
        { success: false, error: "Insufficient tokens", tokens: user.tokens },
        { status: 402 }
      );
    }

    // Deduct tokens and create transaction
    await db.user.update({
      where: { id: userId },
      data: { tokens: { decrement: amount } },
    });

    const transaction = await db.tokenTransaction.create({
      data: {
        userId,
        type: "spend",
        amount: -amount,
        description: description || `Spent ${amount} tokens`,
        referenceId: referenceId || null,
      },
    });

    const updatedUser = await db.user.findUnique({ where: { id: userId } });

    return NextResponse.json({
      success: true,
      tokens: updatedUser?.tokens || 0,
      transaction,
    });
  } catch (error) {
    console.error("Token spend error:", error);
    return NextResponse.json({ success: false, error: "Failed to spend tokens" }, { status: 500 });
  }
}
