import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/project-auth";
import {
  createTalkingPhotoSpeechQuote,
  normalizeTalkingPhotoSpeechSpec,
} from "@/lib/talking-photo-speech-billing";
import { getWalletSummary } from "@/lib/credit-reservations";
import { BillingSafetyError } from "@/lib/provider-cost-billing";
import { getBillingGhsPerUsd } from "@/lib/package-billing-safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const spec = normalizeTalkingPhotoSpeechSpec(body);

    const [{ quote, model, fingerprint, chunks }, wallet, ghsPerUsd] = await Promise.all([
      createTalkingPhotoSpeechQuote({ userId: auth.session.userId, spec }),
      getWalletSummary(auth.session.userId),
      getBillingGhsPerUsd().catch(() => null),
    ]);
    const shortfall = Math.max(0, quote.creditsRequired - wallet.availableCredits);

    return NextResponse.json({
      success: true,
      quoteId: quote.id,
      fingerprint,
      model,
      voice: spec.voice,
      language: spec.language,
      accent: spec.accent,
      style: spec.style,
      scriptChars: spec.script.length,
      chunkCount: chunks.length,
      creditsRequired: quote.creditsRequired,
      providerCostUsd: quote.providerCostUsd,
      bufferedCostUsd: quote.bufferedCostUsd,
      customerValueUsd: quote.customerPriceUsd,
      customerValueGhs: ghsPerUsd ? roundCurrency(quote.customerPriceUsd * ghsPerUsd) : null,
      ghsPerUsd,
      pricingVersion: quote.pricingVersion,
      expiresAt: quote.expiresAt.toISOString(),
      breakdown: quote.breakdown,
      wallet,
      hasEnoughCredits: shortfall === 0,
      shortfallCredits: shortfall,
    });
  } catch (error) {
    const safety = error instanceof BillingSafetyError;
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Could not calculate Digital Actor voice price",
      code: safety ? error.code : "DIGITAL_ACTOR_VOICE_QUOTE_FAILED",
    }, { status: safety ? 409 : 400 });
  }
}
