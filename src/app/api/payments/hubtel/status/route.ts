import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/project-auth";
import { verifyAndSettleByReference } from "@/lib/payment-settlement";

/**
 * GET /api/payments/hubtel/status?reference=xxx
 *
 * Hubtel status checks are owner/admin-only and never mutate payment state
 * directly. Provider verification and token crediting are delegated to the
 * shared exactly-once settlement service.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const reference = req.nextUrl.searchParams.get("reference")?.trim();
    if (!reference || reference.length > 200) {
      return NextResponse.json(
        { success: false, error: "A valid reference query parameter is required" },
        { status: 400 }
      );
    }

    const payment = await db.payment.findFirst({
      where: { gatewayRef: reference },
      select: {
        id: true,
        userId: true,
        status: true,
        settledAt: true,
        tokensPurchased: true,
        bonusTokens: true,
      },
    });
    if (!payment) {
      return NextResponse.json({ success: false, error: "Payment record not found" }, { status: 404 });
    }

    if (payment.userId !== auth.session.userId && auth.session.role !== "admin") {
      return NextResponse.json({ success: false, error: "Not authorized" }, { status: 403 });
    }

    if (payment.status === "completed" && payment.settledAt) {
      return NextResponse.json({
        success: true,
        verified: true,
        alreadySettled: true,
        paymentId: payment.id,
        tokensPurchased: payment.tokensPurchased + payment.bonusTokens,
      });
    }

    const result = await verifyAndSettleByReference(reference);
    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          verified: false,
          paymentId: payment.id,
          error: result.error,
        },
        { status: result.status }
      );
    }

    return NextResponse.json({
      success: true,
      verified: true,
      paymentId: payment.id,
      alreadySettled: result.alreadySettled,
      tokensCredited: result.totalCredited,
      newBalance: result.newBalance,
    });
  } catch (error) {
    console.error("[Hubtel Status Check] Error:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ success: false, error: "Status check failed" }, { status: 500 });
  }
}
