import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/project-auth";
import { zai, cleanLLMOutput } from "@/lib/zai";
import { zaiErrorResponse } from "@/lib/zai-errors";
import { consumePreviewQuota } from "@/lib/preview-limit";
import { deductTokensForOperation } from "@/lib/tokens";
import { PRICING } from "@/lib/pricing";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;

  try {
    const body = await req.json();
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const style = typeof body.style === "string" ? body.style.slice(0, 100) : "";

    if (!prompt) {
      return NextResponse.json(
        { success: false, error: "Prompt is required" },
        { status: 400 }
      );
    }
    if (prompt.length > 4_000) {
      return NextResponse.json(
        { success: false, error: "Prompt is too long" },
        { status: 413 }
      );
    }

    // Prompt enhancement remains a free acquisition feature, but shares the
    // durable text-preview daily budget so an account cannot create unlimited
    // provider spend without tokens.
    const quota = await consumePreviewQuota(authResult.session.userId, "storyboard");
    if (!quota.ok) {
      return NextResponse.json(
        { success: false, error: quota.reason, previewQuota: quota },
        { status: 429 }
      );
    }

    const attemptId = crypto.randomUUID();
    await deductTokensForOperation({
      userId: authResult.session.userId,
      operation: "prompt_enhance",
      description: "Free prompt-enhancement provider attempt",
      referenceId: attemptId,
      idempotencyKey: `prompt-enhance:${attemptId}`,
      customTokens: 0,
      customCostUsd: PRICING.prompt_enhance.costUsd,
    });

    const styleContext = style
      ? `The desired visual style is: ${style}.`
      : "Use a cinematic, professional film style.";
    const systemPrompt =
      "You are a professional cinematographer and video director. Enhance the user's video prompt into a detailed, vivid scene description suitable for AI image generation. Include camera angle, lighting, color palette, mood, composition, and cinematic style. Keep it concise but rich in visual detail (2-3 sentences max). Output ONLY the enhanced description, no preamble or explanation.";
    const userPrompt = `${styleContext}\n\nOriginal prompt: \"${prompt}\"`;

    const raw = await zai.chat({
      systemPrompt,
      userPrompt,
      thinking: "disabled",
      retry: { label: "Enhance prompt", timeoutMs: 45_000, maxRetries: 3 },
    });
    const enhancedPrompt = cleanLLMOutput(raw);

    if (!enhancedPrompt) {
      return NextResponse.json(
        {
          success: false,
          error: "The AI could not enhance your prompt. Please try again or rephrase your input.",
          previewQuota: quota,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      success: true,
      enhancedPrompt,
      previewQuota: quota,
    });
  } catch (error) {
    // Once a provider attempt begins the free quota remains consumed; provider
    // failures/timeouts can still create cost for the platform.
    return zaiErrorResponse(error, {
      session: authResult.session,
      logLabel: "enhance-prompt",
    });
  }
}
