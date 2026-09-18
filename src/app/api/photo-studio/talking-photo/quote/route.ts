import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/project-auth";
import { createTalkingPhotoQuote } from "@/lib/talking-photo-billing";
import { BillingSafetyError } from "@/lib/provider-cost-billing";
import { assertFalTalkingPhotoConfigured, FalProviderError } from "@/lib/fal-lipsync";
import { getWalletSummary } from "@/lib/credit-reservations";
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
    assertFalTalkingPhotoConfigured();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const imageAssetId = typeof body.imageAssetId === "string" ? body.imageAssetId.trim() : "";
    const audioAssetId = typeof body.audioAssetId === "string" ? body.audioAssetId.trim() : "";
    if (!imageAssetId || !audioAssetId) {
      return NextResponse.json({ success: false, error: "Select one photo and one audio file" }, { status: 400 });
    }

    const [image, audio] = await Promise.all([
      db.mediaAsset.findFirst({
        where: { id: imageAssetId, userId: auth.session.userId, kind: "image" },
      }),
      db.mediaAsset.findFirst({
        where: { id: audioAssetId, userId: auth.session.userId, kind: "audio" },
      }),
    ]);
    if (!image || !audio) {
      return NextResponse.json({ success: false, error: "Selected Talking Photo media is unavailable" }, { status: 404 });
    }
    if (!audio.durationSeconds || audio.durationSeconds <= 0 || audio.durationSeconds > 600) {
      return NextResponse.json({ success: false, error: "Audio duration is unavailable or outside the 10-minute limit" }, { status: 409 });
    }

    const [quote, wallet, ghsPerUsd] = await Promise.all([
      createTalkingPhotoQuote({
        userId: auth.session.userId,
        imageAssetId: image.id,
        audioAssetId: audio.id,
        durationSeconds: audio.durationSeconds,
      }),
      getWalletSummary(auth.session.userId),
      getBillingGhsPerUsd().catch(() => null),
    ]);
    const shortfall = Math.max(0, quote.creditsRequired - wallet.availableCredits);
    return NextResponse.json({
      success: true,
      quoteId: quote.id,
      imageAssetId: image.id,
      audioAssetId: audio.id,
      durationSeconds: audio.durationSeconds,
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
    const providerConfig = error instanceof FalProviderError && error.code === "FAL_KEY_MISSING";
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Could not calculate Talking Photo price",
      code: safety ? error.code : providerConfig ? error.code : "TALKING_PHOTO_QUOTE_FAILED",
    }, { status: providerConfig ? 503 : safety ? 409 : 500 });
  }
}
