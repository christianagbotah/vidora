import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getActiveGateway } from "@/lib/payments";
import { v4 as uuid } from "uuid";
import { getActivePackages } from "@/lib/token-packages";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const userId = (session.user as Record<string, unknown>).id as string;
    const body = await req.json();
    const { amount, tokensPurchased, currency, gateway: gatewayOverride, packageId } = body;

    if (!amount || !tokensPurchased) {
      return NextResponse.json(
        { success: false, error: "Amount and tokens are required" },
        { status: 400 }
      );
    }

    // Calculate bonus tokens from the DB package at purchase time
    let bonusTokens = 0;
    try {
      const packages = await getActivePackages();
      const pkg = packageId
        ? packages.find((p) => p.id === packageId || p.slug === packageId)
        : packages.find((p) => p.tokens === tokensPurchased);
      if (pkg) {
        bonusTokens = Math.round((pkg.tokens * pkg.bonusPct) / 100);
      }
    } catch { /* fallback: 0 bonus */ }

    // Determine gateway
    let gatewayName = gatewayOverride;
    if (!gatewayName) {
      const config = await db.systemConfig.findUnique({ where: { key: "payment_gateway" } });
      gatewayName = config?.value || "paystack";
    }

    const reference = `VID-${uuid().slice(0, 8)}-${Date.now()}`;
    const callbackUrl = `${process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/payments/verify`;

    // Create payment record with bonus stored in metadata
    const payment = await db.payment.create({
      data: {
        userId,
        gateway: gatewayName,
        amount,
        currency: currency || "GHS",
        tokensPurchased,
        gatewayRef: reference,
        status: "pending",
        metadata: JSON.stringify({ bonusTokens, packageId: packageId || null }),
      },
    });

    // Fetch user details for Hubtel payee info (optional)
    const user = await db.user.findUnique({ where: { id: userId } });

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
        ...(user?.name ? { userName: user.name } : {}),
        ...(body.phone ? { phone: String(body.phone) } : {}),
      },
    });

    if (!result.success) {
      await db.payment.update({
        where: { id: payment.id },
        data: { status: "failed", metadata: result.error },
      }).catch(() => {/* ignore update failure — don't mask the original error */});
      console.error("Payment gateway init failed:", { gateway: gatewayName, reference, error: result.error });
      // 422 = gateway/config error (not a server crash). The error message is actionable.
      return NextResponse.json(
        { success: false, error: result.error || "Payment initialization failed" },
        { status: 422 }
      );
    }

    return NextResponse.json({
      success: true,
      authorizationUrl: result.authorizationUrl,
      directCheckoutUrl: result.directCheckoutUrl,
      paymentId: payment.id,
      reference,
    });
  } catch (error) {
    console.error("Payment init error:", error);
    const message = error instanceof Error ? error.message : "Payment initialization failed";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
