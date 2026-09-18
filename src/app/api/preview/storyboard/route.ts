import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/project-auth";
import { cleanLLMOutput } from "@/lib/zai";
import { providerBillingErrorResponse } from "@/lib/billing-errors";
import { consumePreviewQuota } from "@/lib/preview-limit";
import { deductTokensForOperation } from "@/lib/tokens";
import { quoteFreeTextAttempt, submitBilledText } from "@/lib/metered-text-billing";

export const runtime = "nodejs";

const STORYBOARD_SYSTEM_PROMPT = `You are Vidora's AI Director. Given a user's video idea, break it into a cinematic scene-by-scene storyboard.

Return ONLY a JSON object (no markdown, no commentary) with this exact shape:
{
  "title": "a short evocative title for the video",
  "logline": "one-sentence summary of the story",
  "estimatedDurationSec": <number, sum of all scene durations>,
  "styleNotes": "2-3 sentences describing the visual style, color palette, and mood",
  "scenes": [
    {
      "sceneNumber": 1,
      "title": "short scene title",
      "visualPrompt": "a rich, detailed visual description of what appears on screen — setting, characters, lighting, camera angle, movement",
      "shotType": "one of: wide shot, medium shot, close-up, extreme close-up, aerial, tracking, dolly, over-the-shoulder, POV",
      "durationSec": <number, 5-15>,
      "mood": "one word: dramatic, joyful, tense, serene, mysterious, epic, melancholic, hopeful",
      "narration": "optional voiceover or dialogue text for this scene, or empty string",
      "transition": "cut, fade, dissolve, or wipe"
    }
  ]
}

Rules:
- Produce between 3 and 8 scenes.
- Each scene 5-15 seconds; total should roughly match a 30-90s video.
- Make visualPrompt detailed enough for image generation.
- Keep the story coherent and emotionally engaging.
- Output ONLY the JSON.`;

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;
  const userId = authResult.session.userId;

  const body = await req.json().catch(() => ({}));
  const idea = typeof body.idea === "string" ? body.idea.trim() : "";
  const style = typeof body.style === "string" ? body.style.slice(0, 100) : "cinematic";
  const aspectRatio = typeof body.aspectRatio === "string" ? body.aspectRatio.slice(0, 20) : "16:9";
  const targetDuration = Math.max(15, Math.min(180, Number(body.targetDuration) || 60));

  if (idea.length < 10) {
    return NextResponse.json(
      { success: false, error: "Please describe your video idea in at least a sentence." },
      { status: 400 }
    );
  }
  if (idea.length > 4000) {
    return NextResponse.json(
      { success: false, error: "Your idea is too long (max 4000 characters)." },
      { status: 400 }
    );
  }

  const userPrompt = `Create a storyboard for this video idea.\n\nUser's idea: ${idea}\n\nPreferences:\n- Visual style: ${style}\n- Aspect ratio: ${aspectRatio}\n- Target duration: ~${targetDuration} seconds\n\nReturn the JSON storyboard now.`;
  let cost;
  try {
    cost = await quoteFreeTextAttempt({
      systemPrompt: STORYBOARD_SYSTEM_PROMPT,
      userPrompt,
      maxOutputTokens: 5_000,
    });
  } catch (error) {
    return providerBillingErrorResponse(error, {
      session: authResult.session,
      fallbackStatus: 409,
      logLabel: "preview-storyboard-price",
    });
  }

  const quota = await consumePreviewQuota(userId, "storyboard");
  if (!quota.ok) {
    return NextResponse.json(
      { success: false, error: quota.reason, previewQuota: quota },
      { status: 429 }
    );
  }

  const attemptId = crypto.randomUUID();
  await deductTokensForOperation({
    userId,
    operation: "preview_storyboard",
    description: `Free storyboard preview provider attempt (${cost.model})`,
    referenceId: attemptId,
    idempotencyKey: `preview-storyboard:${attemptId}`,
    customTokens: 0,
    customCostUsd: cost.providerCostUsd,
  });

  let storyboardJson: string;
  try {
    const result = await submitBilledText({
      provider: cost.provider,
      model: cost.model,
      systemPrompt: STORYBOARD_SYSTEM_PROMPT,
      userPrompt,
      maxOutputTokens: 5_000,
      thinking: "disabled",
      timeoutMs: 60_000,
    });
    storyboardJson = result.content;
  } catch (err) {
    const resp = providerBillingErrorResponse(err, {
      session: authResult.session,
      fallbackStatus: 502,
      logLabel: "preview-storyboard",
    });
    const responseBody = await resp.json();
    responseBody.previewQuota = quota;
    return NextResponse.json(responseBody, { status: resp.status });
  }

  const cleaned = cleanLLMOutput(storyboardJson);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "The AI returned a malformed storyboard. Please try again.",
        previewQuota: quota,
      },
      { status: 502 }
    );
  }

  const sb = parsed as Record<string, unknown>;
  if (!sb || typeof sb !== "object" || !Array.isArray(sb.scenes)) {
    return NextResponse.json(
      { success: false, error: "The AI storyboard was missing required scenes.", previewQuota: quota },
      { status: 502 }
    );
  }

  return NextResponse.json({
    success: true,
    storyboard: sb,
    providerModel: cost.model,
    previewQuota: quota,
  });
}
