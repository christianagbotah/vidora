import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { zai, cleanLLMOutput } from "@/lib/zai";
import { zaiErrorResponse } from "@/lib/zai-errors";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const { prompt, style } = await req.json();

    if (!prompt) {
      return NextResponse.json(
        { success: false, error: "Prompt is required" },
        { status: 400 }
      );
    }

    const styleContext = style
      ? "The desired visual style is: " + style + "."
      : "Use a cinematic, professional film style.";

    const systemPrompt =
      "You are a professional cinematographer and video director. Enhance the user's video prompt into a detailed, vivid scene description suitable for AI image generation. Include specific details about: camera angle, lighting, color palette, mood, composition, and cinematic style. Keep it concise but rich in visual detail (2-3 sentences max). Output ONLY the enhanced description, no preamble or explanation.";

    const userPrompt = styleContext + '\n\nOriginal prompt: "' + prompt + '"';

    const raw = await zai.chat({
      systemPrompt,
      userPrompt,
      thinking: "disabled",
      retry: { label: "Enhance prompt", timeoutMs: 45_000, maxRetries: 3 },
    });

    const enhancedPrompt = cleanLLMOutput(raw);

    if (!enhancedPrompt) {
      return NextResponse.json(
        { success: false, error: "The AI could not enhance your prompt. Please try again or rephrase your input." },
        { status: 422 }
      );
    }

    return NextResponse.json({ success: true, enhancedPrompt });
  } catch (error) {
    // Optional session — admins get the raw diagnostic, everyone else sees a friendly message.
    const session = await getServerSession(authOptions).catch(() => null);
    return zaiErrorResponse(error, {
      session,
      logLabel: "enhance-prompt",
    });
  }
}
