import { NextRequest, NextResponse } from "next/server";
import { getActiveGateway } from "@/lib/payments";
import { db } from "@/lib/db";
import { creditPurchase } from "@/lib/tokens";
import { TOKEN_PACKAGES, getEffectiveTokens } from "@/lib/pricing";

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

    // Verify with gateway
    const gateway = await getActiveGateway();
    const result = await gateway.verifyPayment(payment.gatewayRef || reference);

    if (result.success && result.verified) {
      // Update payment
      await db.payment.update({
        where: { id: payment.id },
        data: { status: "completed" },
      });

      // ── Credit tokens with bonus ──
      // Look up the package to calculate bonus tokens (e.g., 20% extra on Basic)
      // The payment.metadata may store the package ID, or we infer from tokensPurchased
      let baseTokens = payment.tokensPurchased;
      let bonusTokens = 0;
      const pkg = TOKEN_PACKAGES.find((p) => p.tokens === payment.tokensPurchased);
      if (pkg) {
        baseTokens = pkg.tokens;
        bonusTokens = getEffectiveTokens(pkg) - pkg.tokens;
      }

      const creditResult = await creditPurchase({
        userId: payment.userId,
        baseTokens,
        bonusTokens,
        paymentId: payment.id,
        description: `Purchased ${baseTokens} tokens via ${payment.gateway}`,
      });

      return NextResponse.json({
        success: true,
        verified: true,
        tokensPurchased: baseTokens + bonusTokens,
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
    const gateway = await getActiveGateway();
    const result = await gateway.verifyPayment(reference);

    if (result.success && result.verified) {
      await db.payment.update({ where: { id: payment.id }, data: { status: "completed" } });

      // Credit tokens with bonus (same logic as POST handler)
      let baseTokens = payment.tokensPurchased;
      let bonusTokens = 0;
      const pkg = TOKEN_PACKAGES.find((p) => p.tokens === payment.tokensPurchased);
      if (pkg) {
        baseTokens = pkg.tokens;
        bonusTokens = getEffectiveTokens(pkg) - pkg.tokens;
      }

      await creditPurchase({
        userId: payment.userId,
        baseTokens,
        bonusTokens,
        paymentId: payment.id,
        description: `Purchased ${baseTokens} tokens via ${payment.gateway}`,
      });
      return NextResponse.redirect(new URL("/?payment=success", req.url));
    }

    return NextResponse.redirect(new URL("/?payment=error", req.url));
  } catch {
    return NextResponse.redirect(new URL("/?payment=error", req.url));
  }
}
