import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getActiveGateway } from "@/lib/payments";
import { v4 as uuid } from "uuid";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const userId = (session.user as Record<string, unknown>).id as string;
    const body = await req.json();
    const { amount, tokensPurchased, currency, gateway: gatewayOverride } = body;

    if (!amount || !tokensPurchased) {
      return NextResponse.json(
        { success: false, error: "Amount and tokens are required" },
        { status: 400 }
      );
    }

    // Determine gateway
    let gatewayName = gatewayOverride;
    if (!gatewayName) {
      const config = await db.systemConfig.findUnique({ where: { key: "payment_gateway" } });
      gatewayName = config?.value || "paystack";
    }

    const reference = `VID-${uuid().slice(0, 8)}-${Date.now()}`;
    const callbackUrl = `${process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/payments/verify`;

    // Create payment record
    const payment = await db.payment.create({
      data: {
        userId,
        gateway: gatewayName,
        amount,
        currency: currency || "GHS",
        tokensPurchased,
        gatewayRef: reference,
        status: "pending",
      },
    });

    // Initialize with the gateway
    const gateway = await getActiveGateway();
    const result = await gateway.initializePayment({
      email: session.user.email!,
      amount,
      currency: currency || "GHS",
      reference,
      callbackUrl,
      metadata: {
        paymentId: payment.id,
        userId,
        tokens: String(tokensPurchased),
      },
    });

    if (!result.success) {
      await db.payment.update({
        where: { id: payment.id },
        data: { status: "failed", metadata: result.error },
      });
      return NextResponse.json(
        { success: false, error: result.error || "Payment initialization failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      authorizationUrl: result.authorizationUrl,
      paymentId: payment.id,
      reference,
    });
  } catch (error) {
    console.error("Payment init error:", error);
    return NextResponse.json(
      { success: false, error: "Payment initialization failed" },
      { status: 500 }
    );
  }
}
