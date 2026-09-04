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
    const packageId = typeof body.packageId === "string" ? body.packageId.trim() : "";
    if (!packageId) {
      return NextResponse.json({ success: false, error: "packageId is required" }, { status: 400 });
    }

    const packages = await getActivePackages();
    const pkg = packages.find((p) => p.id === packageId || p.slug === packageId);
    if (!pkg || !pkg.isActive) {
      return NextResponse.json({ success: false, error: "Token package is unavailable" }, { status: 400 });
    }

    const gateway = await getActiveGateway();
    const gatewayName = gateway.getName();
    if (body.gateway && String(body.gateway) !== gatewayName) {
      return NextResponse.json(
        { success: false, error: `The requested payment gateway is not currently enabled` },
        { status: 400 }
      );
    }

    let currency = String(body.currency || (gatewayName === "stripe" ? "USD" : "GHS")).toUpperCase();
    if (!new Set(["GHS", "USD"]).has(currency)) {
      return NextResponse.json({ success: false, error: "Unsupported currency" }, { status: 400 });
    }
    if (gatewayName === "hubtel" && currency !== "GHS") {
      return NextResponse.json({ success: false, error: "Hubtel checkout is available in GHS only" }, { status: 400 });
    }

    // Financial entitlement is derived exclusively from the server-side
    // package. Client-provided amount/tokens/bonus fields are intentionally ignored.
    const amount = currency === "USD" ? pkg.priceUSD : pkg.priceGHS;
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ success: false, error: "Package price is not configured" }, { status: 422 });
    }
    const amountMinor = Math.round(amount * 100);
    const baseTokens = pkg.tokens;
    const bonusTokens = Math.round((pkg.tokens * pkg.bonusPct) / 100);

    const reference = `VID-${uuid().replace(/-/g, "").slice(0, 16)}-${Date.now()}`;
    const callbackUrl = `${process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/payments/verify`;
    const purchaseSnapshot = {
      packageId: pkg.id,
      packageSlug: pkg.slug,
      baseTokens,
      bonusTokens,
      amountMinor,
      currency,
      gateway: gatewayName,
      packageUpdatedAt: pkg.updatedAt.toISOString(),
    };

    const payment = await db.payment.create({
      data: {
        userId,
        gateway: gatewayName,
        amount,
        currency,
        tokensPurchased: baseTokens,
        gatewayRef: reference,
        status: "pending",
        metadata: JSON.stringify({ purchaseSnapshot }),
      },
    });

    const user = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
    const result = await gateway.initializePayment({
      email: session.user.email!,
      amount,
      currency,
      reference,
      callbackUrl,
      metadata: {
        paymentId: payment.id,
        packageSlug: pkg.slug,
        tokens: String(baseTokens + bonusTokens),
        ...(user?.name ? { userName: user.name } : {}),
        ...(body.phone ? { phone: String(body.phone) } : {}),
      },
    });

    if (!result.success) {
      await db.payment.update({
        where: { id: payment.id },
        data: {
          status: "failed",
          metadata: JSON.stringify({ purchaseSnapshot, initializationError: result.error || "gateway initialization failed" }),
        },
      }).catch(() => undefined);
      return NextResponse.json({ success: false, error: result.error || "Payment initialization failed" }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      authorizationUrl: result.authorizationUrl,
      directCheckoutUrl: result.directCheckoutUrl,
      paymentId: payment.id,
      reference,
      package: {
        id: pkg.id,
        slug: pkg.slug,
        currency,
        amount,
        baseTokens,
        bonusTokens,
        totalTokens: baseTokens + bonusTokens,
      },
    });
  } catch (error) {
    console.error("Payment initialization error", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ success: false, error: "Payment initialization failed" }, { status: 500 });
  }
}
