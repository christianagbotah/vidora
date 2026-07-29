import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { zai, cleanLLMOutput } from "@/lib/zai";
import { zaiErrorResponse } from "@/lib/zai-errors";
import { consumePreviewQuota, refundPreviewQuota } from "@/lib/preview-limit";
import { db } from "@/lib/db";
import { PRICING } from "@/lib/pricing";

export const runtime = "nodejs";

/**
 * POST /api/preview/storyboard
 *
 * Generates a FREE AI storyboard from the user's video idea — WITHOUT spending
 * tokens and WITHOUT generating expensive video. This is the "try before you
 * buy" funnel step:
 *
 *   User writes idea → AI returns scene-by-scene plan (text only)
 *
 * The user sees exactly how their video will be structured (scene count, shots,
 * durations, narration) so they can decide whether to buy tokens for the real
 * generation. Cost to owner: ~$0.002 (one LLM call). Rate-limited: 10/day.
 *
 * The LLM is instructed to return STRICT JSON so the frontend can render it
 * as a structured storyboard.
 */
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
      "visualPrompt": "a rich, detailed visual description of what appears on screen — setting, characters, lighting, camera angle, movement. This will be used to generate the actual image/video later, so be vivid and specific.",
      "shotType": "one of: wide shot, medium shot, close-up, extreme close-up, aerial, tracking, dolly, over-the-shoulder, POV",
      "durationSec": <number, 5-15>,
      "mood": "one word: dramatic, joyful, tense, serene, mysterious, epic, melancholic, hopeful",
      "narration": "optional voiceover or dialogue text for this scene, or empty string",
      "transition": "how it transitions to the next scene: cut, fade, dissolve, wipe"
    }
  ]
}

Rules:
- Produce between 3 and 8 scenes (scale with the user's requested duration).
- Each scene 5-15 seconds. Total should roughly match a 30-90s video.
- Make visualPrompt detailed enough that an image generator could render it.
- Keep the story coherent and emotionally engaging.
- Output ONLY the JSON. No prose before or after.`;

export async function POST(req: NextRequest) {
  // ── Auth (previews require sign-in so we can rate-limit per user) ──
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "Please sign in to generate a free preview." },
      { status: 401 }
    );
  }
  const userId = (session.user as Record<string, unknown>).id as string;

  // ── Parse input ──
  const body = await req.json().catch(() => ({}));
  const idea = typeof body.idea === "string" ? body.idea.trim() : "";
  const style = typeof body.style === "string" ? body.style : "cinematic";
  const aspectRatio = typeof body.aspectRatio === "string" ? body.aspectRatio : "16:9";
  const targetDuration = Number(body.targetDuration) || 60;

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

  // ── Rate limit (daily free quota) ──
  const quota = await consumePreviewQuota(userId, "storyboard");
  if (!quota.ok) {
    return NextResponse.json(
      {
        success: false,
        error: quota.reason,
        previewQuota: quota,
      },
      { status: 429 }
    );
  }

  // ── Generate storyboard via LLM ──
  const userPrompt = `Create a storyboard for this video idea.

User's idea: ${idea}

Preferences:
- Visual style: ${style}
- Aspect ratio: ${aspectRatio}
- Target duration: ~${targetDuration} seconds

Return the JSON storyboard now.`;

  let storyboardJson: string;
  try {
    storyboardJson = await zai.chat({
      systemPrompt: STORYBOARD_SYSTEM_PROMPT,
      userPrompt,
      model: "glm-4.5",
      thinking: "disabled",
      retry: { label: "Storyboard preview", timeoutMs: 60_000, maxRetries: 2 },
    });
  } catch (err) {
    // Server-side failure (Z.ai down / insufficient balance) — refund the
    // quota so the user isn't penalized for a failure that wasn't their fault.
    await refundPreviewQuota(userId, "storyboard");
    const resp = zaiErrorResponse(err, {
      session: { role: (session.user as Record<string, unknown>).role as string },
      fallbackStatus: 502,
      logLabel: "preview-storyboard",
    });
    const body = await resp.json();
    body.previewQuota = quota;
    return NextResponse.json(body, { status: resp.status });
  }

  // ── Parse & validate the JSON ──
  const cleaned = cleanLLMOutput(storyboardJson);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Malformed LLM output — refund quota (server-side issue)
    await refundPreviewQuota(userId, "storyboard");
    return NextResponse.json(
      {
        success: false,
        error: "The AI returned a malformed storyboard. Please try again.",
        raw: cleaned.slice(0, 500),
        previewQuota: quota,
      },
      { status: 502 }
    );
  }

  // Light validation of shape
  const sb = parsed as Record<string, unknown>;
  if (!sb || typeof sb !== "object" || !Array.isArray(sb.scenes)) {
    await refundPreviewQuota(userId, "storyboard");
    return NextResponse.json(
      { success: false, error: "The AI storyboard was missing required scenes.", previewQuota: quota },
      { status: 502 }
    );
  }

  // ── Record the (free) cost for analytics so the owner sees CAC ──
  await db.tokenTransaction.create({
    data: {
      userId,
      type: "spend",
      amount: 0, // free
      description: `Free storyboard preview: "${(sb.title as string) || "untitled"}"`,
      costUsd: PRICING.preview_storyboard.costUsd,
      operationType: "preview_storyboard",
    },
  }).catch(() => { /* non-fatal */ });

  return NextResponse.json({
    success: true,
    storyboard: sb,
    previewQuota: quota,
  });
}
