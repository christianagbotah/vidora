import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/project-auth";
import { createProjectGenerationQuote } from "@/lib/project-generation-quote";
import { BillingSafetyError } from "@/lib/provider-cost-billing";
import { getBillingGhsPerUsd } from "@/lib/package-billing-safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireProjectAccess(id, true);
    if (!auth.ok) return auth.response;
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const sceneId = typeof body.sceneId === "string" && body.sceneId.trim() ? body.sceneId.trim() : null;
    const result = await createProjectGenerationQuote({
      projectId: id,
      userId: auth.session.userId,
      sceneId,
    });
    const shortfall = Math.max(0, result.quote.creditsRequired - result.wallet.availableCredits);

    // GHS is display-only here. Credits remain the authoritative reservation
    // unit. Reuse Vidora's persisted billing FX rate so this estimate matches
    // package/Hubtel economics without making generation depend on an external
    // exchange-rate request at confirmation time.
    const ghsPerUsd = await getBillingGhsPerUsd().catch(() => null);
    const customerValueGhs = ghsPerUsd
      ? roundCurrency(result.quote.customerPriceUsd * ghsPerUsd)
      : null;
    const breakdown = result.quote.breakdown.map((line) => ({
      ...line,
      customerValueGhs: ghsPerUsd
        ? roundCurrency(line.customerValueUsd * ghsPerUsd)
        : null,
    }));

    return NextResponse.json({
      success: true,
      quoteId: result.quote.id,
      projectId: id,
      sceneId,
      sceneCount: result.sceneCount,
      creditsRequired: result.quote.creditsRequired,
      providerCostUsd: result.quote.providerCostUsd,
      bufferedCostUsd: result.quote.bufferedCostUsd,
      customerValueUsd: result.quote.customerPriceUsd,
      customerValueGhs,
      ghsPerUsd,
      pricingVersion: result.quote.pricingVersion,
      expiresAt: result.quote.expiresAt.toISOString(),
      breakdown,
      wallet: result.wallet,
      hasEnoughCredits: shortfall === 0,
      shortfallCredits: shortfall,
    });
  } catch (error) {
    const safety = error instanceof BillingSafetyError;
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Could not calculate a safe generation price",
      code: safety ? error.code : "COST_QUOTE_FAILED",
    }, { status: safety ? 409 : 500 });
  }
}
