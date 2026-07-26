import { NextRequest, NextResponse } from "next/server";
import { zai, ZAIError, cleanLLMOutput } from "@/lib/zai";

/**
 * AI Director Mode — Enhance scene prompts with camera movements, lighting, mood, and cinematography.
 * This is what makes Vidora unique: AI-powered director-level control over every scene.
 */

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
  try {
    const { prompt, sceneIndex, totalScenes, style, mood, cameraMove, lighting } = await req.json();

    if (!prompt) {
      return NextResponse.json({ success: false, error: "Prompt is required" }, { status: 400 });
    }

    const systemPrompt = [
      "You are an elite AI Film Director and Cinematographer.",
      "Your job is to enhance a scene description for AI video generation.",
      "You add professional cinematographic details: camera movement, lighting, mood, framing.",
      "",
      "RULES:",
      "- Keep the core visual content from the original prompt",
      "- Add ONE specific camera movement",
      "- Add specific lighting description",
      "- Add mood/atmosphere through visual details",
      "- Keep the prompt under 200 words",
      "- Return ONLY the enhanced prompt text, no explanations, no quotes, no markdown",
    ].join("\n");

    const userPrompt = [
      `Scene ${sceneIndex + 1} of ${totalScenes}`,
      `Style: ${style || "cinematic"}`,
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

    // AI also suggests the mood, camera, and lighting it chose
    let aiMood = mood || "cinematic";
    let aiCamera = cameraMove || "tracking shot";
    let aiLighting = lighting || "golden hour";

    // Simple heuristic extraction from the enhanced prompt
    const lower = enhancedPrompt.toLowerCase();
    for (const m of MOODS) {
      if (lower.includes(m)) { aiMood = m; break; }
    }
    for (const c of CAMERA_MOVES) {
      if (lower.includes(c)) { aiCamera = c; break; }
    }
    for (const l of LIGHTING) {
      if (lower.includes(l)) { aiLighting = l; break; }
    }

    return NextResponse.json({
      success: true,
      enhancedPrompt,
      mood: aiMood,
      cameraMove: aiCamera,
      lighting: aiLighting,
    });
  } catch (error) {
    const message = error instanceof ZAIError ? error.message : error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to enhance scene:", error);
    return NextResponse.json(
      { success: false, error: "Enhancement failed: " + message },
      { status: error instanceof ZAIError && error.kind === "auth" ? 503 : 500 }
    );
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
