import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/project-auth";
import { verifyAndSettleByReference } from "@/lib/payment-settlement";

/**
 * Authenticated client verification. The caller may only verify their own
 * payment (admins may assist), and settlement always uses provider-side
 * verification plus the shared exactly-once transaction.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => ({}));
    const paymentId = typeof body.paymentId === "string" ? body.paymentId.trim() : "";
    const reference = typeof body.reference === "string" ? body.reference.trim() : "";
    if ((!paymentId && !reference) || paymentId.length > 200 || reference.length > 200) {
      return NextResponse.json({ success: false, error: "A valid paymentId or reference is required" }, { status: 400 });
    }

    const payment = paymentId
      ? await db.payment.findUnique({ where: { id: paymentId } })
      : await db.payment.findFirst({ where: { gatewayRef: reference } });

    if (!payment || !payment.gatewayRef) {
      return NextResponse.json({ success: false, error: "Payment not found" }, { status: 404 });
    }
    if (payment.userId !== auth.session.userId && auth.session.role !== "admin") {
      return NextResponse.json({ success: false, error: "Not authorized" }, { status: 403 });
    }

    const result = await verifyAndSettleByReference(payment.gatewayRef);
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

/**
 * Browser/provider return endpoint. Query-string status values are never proof
 * of payment or cancellation and therefore never mutate Payment. The stored
 * provider reference is verified server-to-server before settlement.
 */
export async function GET(req: NextRequest) {
  const reference = req.nextUrl.searchParams.get("reference")?.trim() || "";
  if (!reference || reference.length > 200) {
    return NextResponse.redirect(new URL("/?payment=error", req.url));
  }

  try {
    const payment = await db.payment.findFirst({ where: { gatewayRef: reference } });
    if (!payment) return NextResponse.redirect(new URL("/?payment=error", req.url));

    if (payment.status === "completed" && payment.settledAt) {
      return NextResponse.redirect(new URL("/?payment=success", req.url));
    }

    const result = await verifyAndSettleByReference(reference);
    return NextResponse.redirect(new URL(result.success ? "/?payment=success" : "/?payment=error", req.url));
  } catch (error) {
    console.error("Payment callback verification error", error instanceof Error ? error.message : "unknown error");
    return NextResponse.redirect(new URL("/?payment=error", req.url));
  }
}
