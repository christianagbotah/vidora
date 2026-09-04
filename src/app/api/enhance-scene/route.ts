import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/project-auth";
import { zai, cleanLLMOutput } from "@/lib/zai";
import { zaiErrorResponse } from "@/lib/zai-errors";
import { deductTokensForOperation } from "@/lib/tokens";

export const runtime = "nodejs";

const CAMERA_MOVES = [
  "slow zoom in", "slow zoom out", "pan left", "pan right", "tracking shot",
  "crane shot ascending", "crane shot descending", "dolly forward", "dolly backward",
  "orbit shot", "tilt up", "tilt down", "static locked shot", "handheld shaky cam",
  "steady cam glide", "aerial drone shot", "low angle hero shot", "high angle overhead",
];

const MOODS = [
  "dramatic", "serene", "tense", "joyful", "melancholic", "epic", "mysterious",
  "romantic", "whimsical", "dark", "ethereal", "nostalgic", "triumphant", "suspenseful",
];

const LIGHTING = [
  "golden hour", "blue hour", "neon lit", "candlelight", "moonlight", "overcast soft",
  "harsh sunlight", "studio lighting", "volumetric god rays", "backlit silhouette",
  "underwater caustics", "firelight warm glow", "fluorescent clinical", "dramatic chiaroscuro",
];

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;

  try {
    const body = await req.json();
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
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

    const sceneIndex = Number.isFinite(Number(body.sceneIndex)) ? Number(body.sceneIndex) : 0;
    const totalScenes = Number.isFinite(Number(body.totalScenes)) ? Math.max(1, Number(body.totalScenes)) : 1;
    const style = typeof body.style === "string" ? body.style.slice(0, 100) : "cinematic";
    const mood = typeof body.mood === "string" ? body.mood.slice(0, 100) : "";
    const cameraMove = typeof body.cameraMove === "string" ? body.cameraMove.slice(0, 100) : "";
    const lighting = typeof body.lighting === "string" ? body.lighting.slice(0, 100) : "";

    const operationId = crypto.randomUUID();
    const deduction = await deductTokensForOperation({
      userId: authResult.session.userId,
      operation: "llm",
      description: `AI Director enhancement for scene ${sceneIndex + 1}`,
      referenceId: operationId,
      idempotencyKey: `enhance-scene:${operationId}`,
    });
    if (!deduction.success) {
      return NextResponse.json(
        { success: false, error: deduction.error || "Insufficient tokens" },
        { status: 402 }
      );
    }

    const systemPrompt = [
      "You are an elite AI Film Director and Cinematographer.",
      "Enhance a scene description for AI video generation.",
      "Keep the original visual content, add one camera movement, specific lighting and visual mood.",
      "Keep the prompt under 200 words.",
      "Return ONLY the enhanced prompt text, no explanations, quotes, or markdown.",
    ].join("\n");

    const userPrompt = [
      `Scene ${sceneIndex + 1} of ${totalScenes}`,
      `Style: ${style}`,
      mood ? `Desired Mood: ${mood}` : "",
      cameraMove ? `Camera: ${cameraMove}` : "Camera: choose the best movement for this scene",
      lighting ? `Lighting: ${lighting}` : "Lighting: choose the best lighting for this scene",
      "",
      "Original scene prompt:",
      prompt,
    ].filter(Boolean).join("\n");

    const raw = await zai.chat({
      systemPrompt,
      userPrompt,
      thinking: "disabled",
      retry: { label: "AI Director prompt enhancement", timeoutMs: 45_000, maxRetries: 3 },
    });
    const enhancedPrompt = cleanLLMOutput(raw) || prompt;

    let aiMood = mood || "cinematic";
    let aiCamera = cameraMove || "tracking shot";
    let aiLighting = lighting || "golden hour";
    const lower = enhancedPrompt.toLowerCase();
    for (const value of MOODS) {
      if (lower.includes(value)) { aiMood = value; break; }
    }
    for (const value of CAMERA_MOVES) {
      if (lower.includes(value)) { aiCamera = value; break; }
    }
    for (const value of LIGHTING) {
      if (lower.includes(value)) { aiLighting = value; break; }
    }

    return NextResponse.json({
      success: true,
      enhancedPrompt,
      mood: aiMood,
      cameraMove: aiCamera,
      lighting: aiLighting,
      tokensCharged: deduction.alreadyApplied ? 0 : 1,
      remainingTokens: deduction.remainingTokens,
    });
  } catch (error) {
    return zaiErrorResponse(error, {
      session: authResult.session,
      logLabel: "enhance-scene",
    });
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    cameraMoves: CAMERA_MOVES,
    moods: MOODS,
    lighting: LIGHTING,
  });
}
