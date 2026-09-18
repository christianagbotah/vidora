import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/project-auth";
import { getWalletSummary } from "@/lib/credit-reservations";
import { providerBillingErrorResponse } from "@/lib/billing-errors";
import { createTalkingPhotoSpeechQuote } from "@/lib/talking-photo-speech-billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const result = await createTalkingPhotoSpeechQuote({
      userId: auth.session.userId,
      input: {
        script: typeof body.script === "string" ? body.script : "",
        voice: typeof body.voice === "string" ? body.voice : null,
        language: typeof body.language === "string" ? body.language : null,
        accent: typeof body.accent === "string" ? body.accent : null,
      },
    });

    if (result.replayed) {
      return NextResponse.json({
        success: true,
        replayed: true,
        job: result.job,
        asset: result.asset,
        creditsRequired: 0,
      });
    }

    const wallet = await getWalletSummary(auth.session.userId);
    return NextResponse.json({
      success: true,
      replayed: false,
      jobId: result.job.id,
      quoteId: result.quote.id,
      chunks: result.chunks.length,
      characters: result.chunks.reduce((sum, chunk) => sum + chunk.length, 0),
      provider: "qwen",
      model: result.model,
      creditsRequired: result.quote.creditsRequired,
      providerCostUsd: result.quote.providerCostUsd,
      customerValueUsd: result.quote.customerPriceUsd,
      expiresAt: result.quote.expiresAt,
      wallet,
      hasEnoughCredits: wallet.availableCredits >= result.quote.creditsRequired,
      shortfallCredits: Math.max(0, result.quote.creditsRequired - wallet.availableCredits),
    });
  } catch (error) {
    return providerBillingErrorResponse(error, {
      session: auth.session,
      fallbackStatus: 503,
      fallbackMessage: "Scripted speech is temporarily unavailable. Check the Qwen provider configuration and try again.",
      logLabel: "talking-photo-speech-quote",
    });
  }
}
