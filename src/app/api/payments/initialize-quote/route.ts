import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/project-auth";
import { getActiveGateway } from "@/lib/payments";
import { getBillingQuote, getWalletSummary } from "@/lib/credit-reservations";
import { getCommercialPricingPolicy } from "@/lib/provider-cost-billing";
import { getBillingGhsPerUsd } from "@/lib/package-billing-safety";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json() as Record<string, unknown>;
    const quoteId = typeof body.quoteId === "string" ? body.quoteId.trim() : "";
    if (!quoteId) return NextResponse.json({ success: false, error: "quoteId is required" }, { status: 400 });

    const quote = await getBillingQuote(quoteId);
    if (!quote || quote.userId !== auth.session.userId) {
      return NextResponse.json({ success: false, error: "Billing quote not found" }, { status: 404 });
    }
    if (quote.status !== "open" || quote.expiresAt.getTime() <= Date.now()) {
      return NextResponse.json({ success: false, error: "Billing quote expired or is no longer payable. Request a fresh quote." }, { status: 409 });
    }

    const [wallet, policy, ghsPerUsd, gateway] = await Promise.all([
      getWalletSummary(auth.session.userId),
      getCommercialPricingPolicy(),
      getBillingGhsPerUsd(),
      getActiveGateway(),
    ]);
    if (!policy.billingEnabled) {
      return NextResponse.json({ success: false, error: "Paid AI generation is temporarily disabled." }, { status: 409 });
    }
    if (gateway.getName() !== "hubtel") {
      return NextResponse.json({ success: false, error: "Exact quote top-up currently requires Hubtel as the active gateway." }, { status: 409 });
    }

    const shortfallCredits = Math.max(0, quote.creditsRequired - wallet.availableCredits);
    if (shortfallCredits === 0) {
      return NextResponse.json({ success: true, alreadyFunded: true, quoteId, shortfallCredits: 0, wallet });
    }

    const valueUsd = shortfallCredits * policy.creditValueUsd;
    const amountMinor = Math.ceil((valueUsd * ghsPerUsd * 100) - 1e-9);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      return NextResponse.json({ success: false, error: "Could not calculate a safe Hubtel top-up amount." }, { status: 422 });
    }
    const amount = amountMinor / 100;
    const reference = `VIDQ-${uuid().replace(/-/g, "").slice(0, 14)}-${Date.now()}`;
    const callbackUrl = `${process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/payments/verify`;
    const purchaseSnapshot = {
      quoteId,
      baseTokens: shortfallCredits,
      bonusTokens: 0,
      amountMinor,
      currency: "GHS",
      gateway: "hubtel",
      creditValueUsd: policy.creditValueUsd,
      ghsPerUsd,
      pricingVersion: quote.pricingVersion,
    };

    const payment = await db.payment.create({
      data: {
        userId: auth.session.userId,
        gateway: "hubtel",
        gatewayRef: reference,
        packageSlug: null,
        amount,
        expectedAmountMinor: amountMinor,
        currency: "GHS",
        tokensPurchased: shortfallCredits,
        bonusTokens: 0,
        settlementKey: `payment:hubtel:${reference}`,
        status: "pending",
        metadata: JSON.stringify({ purchaseSnapshot, quoteTopUp: true }),
      },
    });

    const result = await gateway.initializePayment({
      email: auth.session.email || "",
      amount,
      currency: "GHS",
      reference,
      callbackUrl,
      metadata: {
        paymentId: payment.id,
        quoteId,
        tokens: String(shortfallCredits),
        ...(body.phone ? { phone: String(body.phone) } : {}),
      },
    });
    if (!result.success) {
      await db.payment.update({
        where: { id: payment.id },
        data: { status: "failed", metadata: JSON.stringify({ purchaseSnapshot, quoteTopUp: true, initializationError: result.error || "gateway initialization failed" }) },
      }).catch(() => undefined);
      return NextResponse.json({ success: false, error: result.error || "Hubtel top-up initialization failed" }, { status: 422 });
    }
    if (result.providerTransactionId) {
      await db.payment.update({ where: { id: payment.id }, data: { providerTransactionId: result.providerTransactionId } }).catch(() => undefined);
    }

    return NextResponse.json({
      success: true,
      quoteId,
      paymentId: payment.id,
      reference,
      authorizationUrl: result.authorizationUrl,
      directCheckoutUrl: result.directCheckoutUrl,
      shortfallCredits,
      amountGhs: amount,
      ghsPerUsd,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Could not initialize quote top-up",
    }, { status: 500 });
  }
}
