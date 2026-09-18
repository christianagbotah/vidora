import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/project-auth";
import { cleanLLMOutput } from "@/lib/zai";
import { providerBillingErrorResponse } from "@/lib/billing-errors";
import { reserveMeteredTextOperation, submitBilledText } from "@/lib/metered-text-billing";
import { captureActualMeteredLine, finalizeMeteredReservation } from "@/lib/metered-settlement";

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
    if (!prompt) return NextResponse.json({ success: false, error: "Prompt is required" }, { status: 400 });
    if (prompt.length > 4_000) return NextResponse.json({ success: false, error: "Prompt is too long" }, { status: 413 });

    const sceneIndex = Number.isFinite(Number(body.sceneIndex)) ? Number(body.sceneIndex) : 0;
    const totalScenes = Number.isFinite(Number(body.totalScenes)) ? Math.max(1, Number(body.totalScenes)) : 1;
    const style = typeof body.style === "string" ? body.style.slice(0, 100) : "cinematic";
    const mood = typeof body.mood === "string" ? body.mood.slice(0, 100) : "";
    const cameraMove = typeof body.cameraMove === "string" ? body.cameraMove.slice(0, 100) : "";
    const lighting = typeof body.lighting === "string" ? body.lighting.slice(0, 100) : "";

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
      "", "Original scene prompt:", prompt,
    ].filter(Boolean).join("\n");

    const operationId = crypto.randomUUID();
    const lineKeyPrefix = `enhance-scene:${operationId}`;
    const billing = await reserveMeteredTextOperation({
      userId: authResult.session.userId,
      referenceId: operationId,
      idempotencyKey: `${lineKeyPrefix}:reservation`,
      lineKeyPrefix,
      label: `AI Director enhancement for scene ${sceneIndex + 1}`,
      systemPrompt,
      userPrompt,
      maxOutputTokens: 800,
    });

    const result = await submitBilledText({
      provider: billing.provider,
      model: billing.model,
      systemPrompt,
      userPrompt,
      maxOutputTokens: 800,
      thinking: "disabled",
      timeoutMs: 45_000,
    });
    if (!result.usage) {
      throw new Error("Paid text provider returned no usage metadata; the prepaid reserve is held for reconciliation rather than guessing the charge");
    }
    const inputCapture = await captureActualMeteredLine({
      reservationId: billing.reservation.id,
      lineKey: `${lineKeyPrefix}:input`,
      userId: authResult.session.userId,
      actualQuantity: result.usage.inputTokens,
    });
    const outputCapture = await captureActualMeteredLine({
      reservationId: billing.reservation.id,
      lineKey: `${lineKeyPrefix}:output`,
      userId: authResult.session.userId,
      actualQuantity: result.usage.outputTokens,
    });
    const finalized = await finalizeMeteredReservation({
      reservationId: billing.reservation.id,
      userId: authResult.session.userId,
      reason: "AI Director actual provider token usage settled",
    });

    const enhancedPrompt = cleanLLMOutput(result.content) || prompt;
    let aiMood = mood || "cinematic";
    let aiCamera = cameraMove || "tracking shot";
    let aiLighting = lighting || "golden hour";
    const lower = enhancedPrompt.toLowerCase();
    for (const value of MOODS) if (lower.includes(value)) { aiMood = value; break; }
    for (const value of CAMERA_MOVES) if (lower.includes(value)) { aiCamera = value; break; }
    for (const value of LIGHTING) if (lower.includes(value)) { aiLighting = value; break; }

    return NextResponse.json({
      success: true,
      enhancedPrompt,
      mood: aiMood,
      cameraMove: aiCamera,
      lighting: aiLighting,
      providerModel: billing.model,
      tokensCharged: inputCapture.creditsCaptured + outputCapture.creditsCaptured,
      creditsReleased: finalized.creditsReleased,
      remainingTokens: finalized.wallet.availableCredits,
    });
  } catch (error) {
    return providerBillingErrorResponse(error, { session: authResult.session, logLabel: "enhance-scene" });
  }
}

export async function GET() {
  return NextResponse.json({ success: true, cameraMoves: CAMERA_MOVES, moods: MOODS, lighting: LIGHTING });
}
