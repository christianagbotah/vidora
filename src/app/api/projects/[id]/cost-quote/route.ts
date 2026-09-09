import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/project-auth";
import { createProjectGenerationQuote } from "@/lib/project-generation-quote";
import { BillingSafetyError } from "@/lib/provider-cost-billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireProjectAccess(id, true);
    if (!auth.ok) return auth.response;
    const result = await createProjectGenerationQuote({
      projectId: id,
      userId: auth.session.userId,
    });
    const shortfall = Math.max(0, result.quote.creditsRequired - result.wallet.availableCredits);
    return NextResponse.json({
      success: true,
      quoteId: result.quote.id,
      projectId: id,
      sceneCount: result.sceneCount,
      creditsRequired: result.quote.creditsRequired,
      providerCostUsd: result.quote.providerCostUsd,
      bufferedCostUsd: result.quote.bufferedCostUsd,
      customerValueUsd: result.quote.customerPriceUsd,
      pricingVersion: result.quote.pricingVersion,
      expiresAt: result.quote.expiresAt.toISOString(),
      breakdown: result.quote.breakdown,
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
