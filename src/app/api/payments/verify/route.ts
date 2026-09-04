import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyAndSettleByReference } from "@/lib/payment-settlement";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const payment = body.paymentId
      ? await db.payment.findUnique({ where: { id: String(body.paymentId) } })
      : body.reference
        ? await db.payment.findFirst({ where: { gatewayRef: String(body.reference) } })
        : null;

    if (!payment) {
      return NextResponse.json({ success: false, error: "Payment not found" }, { status: 404 });
    }

    const result = await verifyAndSettleByReference(payment.gatewayRef || "");
    if (!result.success) {
      return NextResponse.json({ success: false, verified: false, error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      success: true,
      verified: true,
      alreadySettled: result.alreadySettled,
      tokensCredited: result.totalCredited,
      newBalance: result.newBalance,
    });
  } catch (error) {
    console.error("Payment verification error", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ success: false, error: "Verification failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const reference = searchParams.get("reference");
  const callbackStatus = searchParams.get("status");

  if (!reference) return NextResponse.redirect(new URL("/?payment=error", req.url));

  try {
    const payment = await db.payment.findFirst({ where: { gatewayRef: reference } });
    if (!payment) return NextResponse.redirect(new URL("/?payment=error", req.url));

    if (payment.status === "completed") {
      return NextResponse.redirect(new URL("/?payment=success", req.url));
    }

    if (callbackStatus === "cancelled") {
      await db.payment.updateMany({
        where: { id: payment.id, status: "pending" },
        data: { status: "failed" },
      });
      return NextResponse.redirect(new URL("/?payment=cancelled", req.url));
    }

    // Browser redirects are never trusted as proof of payment. Always verify
    // server-to-server with the provider before atomic settlement.
    const result = await verifyAndSettleByReference(reference);
    return NextResponse.redirect(new URL(result.success ? "/?payment=success" : "/?payment=error", req.url));
  } catch (error) {
    console.error("Payment callback verification error", error instanceof Error ? error.message : "unknown error");
    return NextResponse.redirect(new URL("/?payment=error", req.url));
  }
}
