import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { HubtelGateway } from "@/lib/payments";
import { creditPurchase } from "@/lib/tokens";

/**
 * Extract bonusTokens from payment metadata (stored at creation time).
 */
function getBonusTokens(payment: { metadata: string | null }): number {
  try {
    if (payment.metadata) {
      const meta = JSON.parse(payment.metadata);
      return typeof meta.bonusTokens === "number" ? meta.bonusTokens : 0;
    }
  } catch { /* ignore */ }
  return 0;
}

/**
 * Hubtel Transaction Status Check (Mandatory per Hubtel docs)
 *
 * If a callback is NOT received within 5 minutes of initiating a transaction,
 * the merchant MUST call the Transaction Status Check API to determine the
 * final status.
 *
 * Endpoint: GET /api/payments/hubtel/status?reference=xxx
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const reference = searchParams.get("reference");

    if (!reference) {
      return NextResponse.json(
        { success: false, error: "reference query parameter is required" },
        { status: 400 }
      );
    }

    // Find the payment record
    const payment = await db.payment.findFirst({ where: { gatewayRef: reference } });

    if (!payment) {
      return NextResponse.json(
        { success: false, error: "Payment record not found" },
        { status: 404 }
      );
    }

    if (payment.status === "completed") {
      const bonusTokens = getBonusTokens(payment);
      return NextResponse.json({
        success: true,
        alreadyCompleted: true,
        paymentId: payment.id,
        tokensPurchased: payment.tokensPurchased + bonusTokens,
        bonusTokens,
        message: "Payment already completed and tokens credited.",
      });
    }

    // Call Hubtel status API
    const gateway = new HubtelGateway();
    const result = await gateway.verifyPayment(reference);

    if (result.success && result.verified) {
      const bonusTokens = getBonusTokens(payment);

      // Payment confirmed — credit tokens
      await db.payment.update({
        where: { id: payment.id },
        data: { status: "completed" },
      });

      const creditResult = await creditPurchase({
        userId: payment.userId,
        baseTokens: payment.tokensPurchased,
        bonusTokens,
        paymentId: payment.id,
        description: `Purchased ${payment.tokensPurchased} tokens via Hubtel (status check)`,
      });

      return NextResponse.json({
        success: true,
        verified: true,
        paymentId: payment.id,
        tokensPurchased: payment.tokensPurchased + bonusTokens,
        bonusTokens,
        newBalance: creditResult.newBalance,
        hubtelAmount: result.amount,
        message: "Payment verified via status check. Tokens credited.",
      });
    }

    return NextResponse.json({
      success: true,
      verified: false,
      paymentId: payment.id,
      currentStatus: payment.status,
      error: result.error || "Payment not yet completed",
      message: "Payment has not been completed yet. The customer may still be processing the payment.",
    });
  } catch (error) {
    console.error("[Hubtel Status Check] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Status check failed",
      },
      { status: 500 }
    );
  }
}
