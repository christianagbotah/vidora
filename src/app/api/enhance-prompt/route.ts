import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

export async function POST(req: NextRequest) {
  try {
    const { prompt, style } = await req.json();

    if (!prompt) {
      return NextResponse.json(
        { success: false, error: "Prompt is required" },
        { status: 400 }
      );
    }

    const zai = await ZAI.create();

    const styleContext = style
      ? "The desired visual style is: " + style + "."
      : "Use a cinematic, professional film style.";

    const systemPrompt =
      "You are a professional cinematographer and video director. Enhance the user's video prompt into a detailed, vivid scene description suitable for AI image generation. Include specific details about: camera angle, lighting, color palette, mood, composition, and cinematic style. Keep it concise but rich in visual detail (2-3 sentences max). Output ONLY the enhanced description, no preamble or explanation.";

    const userPrompt = styleContext + "\n\nOriginal prompt: \"" + prompt + "\"";

    const completion = await zai.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      thinking: { type: "disabled" },
    });

    const enhancedPrompt = completion.choices[0]?.message?.content?.trim()
      .replace(/^```[a-z]*\n?/g, "")
      .replace(/```$/g, "")
      .replace(/^["']|["']$/g, "")
      .trim();

    if (!enhancedPrompt) {
      return NextResponse.json(
        { success: false, error: "The AI could not enhance your prompt. Please try again or rephrase your input." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, enhancedPrompt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to enhance prompt:", error);
    return NextResponse.json(
      { success: false, error: "Could not enhance your prompt: " + message },
      { status: 500 }
    );
  }
}
