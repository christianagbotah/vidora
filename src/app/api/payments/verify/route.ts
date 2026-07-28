import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { paymentId, reference } = body;

    if (!paymentId && !reference) {
      return NextResponse.json(
        { success: false, error: "paymentId or reference is required" },
        { status: 400 }
      );
    }

    // Find payment record
    const payment = paymentId
      ? await db.payment.findUnique({ where: { id: paymentId } })
      : await db.payment.findFirst({ where: { gatewayRef: reference } });

    if (!payment) {
      return NextResponse.json(
        { success: false, error: "Payment not found" },
        { status: 404 }
      );
    }

    if (payment.status === "completed") {
      return NextResponse.json({
        success: true,
        verified: true,
        tokensPurchased: payment.tokensPurchased,
      });
    }

    // Verify with gateway (import dynamically to avoid circular deps)
    const { getActiveGateway } = await import("@/lib/payments");
    const gateway = await getActiveGateway();
    const result = await gateway.verifyPayment(payment.gatewayRef || reference);

    if (result.success && result.verified) {
      const bonusTokens = getBonusTokens(payment);

      // Update payment
      await db.payment.update({
        where: { id: payment.id },
        data: { status: "completed" },
      });

      // Credit tokens with bonus using creditPurchase (atomic, records transactions)
      const creditResult = await creditPurchase({
        userId: payment.userId,
        baseTokens: payment.tokensPurchased,
        bonusTokens,
        paymentId: payment.id,
        description: `Purchased ${payment.tokensPurchased} tokens via ${payment.gateway}`,
      });

      return NextResponse.json({
        success: true,
        verified: true,
        tokensPurchased: payment.tokensPurchased + bonusTokens,
        bonusTokens,
        newBalance: creditResult.newBalance,
      });
    }

    if (result.error) {
      await db.payment.update({
        where: { id: payment.id },
        data: { status: "failed" },
      });
    }

    return NextResponse.json({
      success: true,
      verified: false,
      error: result.error,
    });
  } catch (error) {
    console.error("Payment verify error:", error);
    return NextResponse.json(
      { success: false, error: "Verification failed" },
      { status: 500 }
    );
  }
}

// Also support GET for callback redirect verification
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const reference = searchParams.get("reference");
    const status = searchParams.get("status");

    if (!reference) {
      return NextResponse.redirect(new URL("/?payment=error", req.url));
    }

    const payment = await db.payment.findFirst({ where: { gatewayRef: reference } });

    if (!payment) {
      return NextResponse.redirect(new URL("/?payment=error", req.url));
    }

    if (payment.status === "completed") {
      return NextResponse.redirect(new URL("/?payment=success", req.url));
    }

    if (status === "cancelled") {
      await db.payment.update({
        where: { id: payment.id },
        data: { status: "failed" },
      });
      return NextResponse.redirect(new URL("/?payment=cancelled", req.url));
    }

    // Try verification
    const { getActiveGateway } = await import("@/lib/payments");
    const gateway = await getActiveGateway();
    const result = await gateway.verifyPayment(reference);

    if (result.success && result.verified) {
      const bonusTokens = getBonusTokens(payment);

      await db.payment.update({ where: { id: payment.id }, data: { status: "completed" } });

      await creditPurchase({
        userId: payment.userId,
        baseTokens: payment.tokensPurchased,
        bonusTokens,
        paymentId: payment.id,
        description: `Purchased ${payment.tokensPurchased} tokens via ${payment.gateway}`,
      });
      return NextResponse.redirect(new URL("/?payment=success", req.url));
    }

    return NextResponse.redirect(new URL("/?payment=error", req.url));
  } catch {
    return NextResponse.redirect(new URL("/?payment=error", req.url));
  }
}
