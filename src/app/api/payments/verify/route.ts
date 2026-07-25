import { NextRequest, NextResponse } from "next/server";
import { getActiveGateway } from "@/lib/payments";
import { db } from "@/lib/db";

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

      // Credit user tokens
      await db.user.update({
        where: { id: payment.userId },
        data: { tokens: { increment: payment.tokensPurchased } },
      });

      // Record transaction
      await db.tokenTransaction.create({
        data: {
          userId: payment.userId,
          type: "purchase",
          amount: payment.tokensPurchased,
          description: `Purchased ${payment.tokensPurchased} tokens via ${payment.gateway}`,
          referenceId: payment.id,
        },
      });

      return NextResponse.json({
        success: true,
        verified: true,
        tokensPurchased: payment.tokensPurchased,
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
      await db.user.update({
        where: { id: payment.userId },
        data: { tokens: { increment: payment.tokensPurchased } },
      });
      await db.tokenTransaction.create({
        data: {
          userId: payment.userId,
          type: "purchase",
          amount: payment.tokensPurchased,
          description: `Purchased ${payment.tokensPurchased} tokens via ${payment.gateway}`,
          referenceId: payment.id,
        },
      });
      return NextResponse.redirect(new URL("/?payment=success", req.url));
    }

    return NextResponse.redirect(new URL("/?payment=error", req.url));
  } catch {
    return NextResponse.redirect(new URL("/?payment=error", req.url));
  }
}
