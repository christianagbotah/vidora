import { NextRequest, NextResponse } from "next/server";
import { zai, ZAIError } from "@/lib/zai";

export async function POST(req: NextRequest) {
  let tempPath: string | null = null;
  try {
    const formData = await req.formData();
    const videoFile = formData.get("video") as File | null;

    if (!videoFile) {
      return NextResponse.json(
        { success: false, error: "No video file provided" },
        { status: 400 }
      );
    }

    const bytes = await videoFile.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // The ZAI vision endpoint requires a publicly-reachable URL or a data URL.
    // We use a data URL (base64) so no file hosting is needed.
    const ext = videoFile.name.split(".").pop() || "mp4";
    const mimeType = ext === "webm" ? "video/webm" : ext === "mov" ? "video/quicktime" : "video/mp4";
    const base64Video = buffer.toString("base64");
    const dataUrl = `data:${mimeType};base64,${base64Video}`;

    const analyzePrompt =
      "Analyze this video and provide a detailed scene description that could be used to recreate a similar video with AI. Describe: the visual style, camera work, subjects, actions, environment, lighting, mood, and color palette. Be specific and cinematic. Then on a new line starting with 'PROMPT:', provide a concise 1-2 sentence prompt that could be used for AI image generation to recreate this scene.";

    const content = await zai.vision({
      model: "glm-4v",
      thinking: "enabled",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: analyzePrompt },
            {
              type: "video_url",
              video_url: { url: dataUrl },
            },
          ],
        },
      ],
      retry: { label: "Analyze video", timeoutMs: 180_000, maxRetries: 3 },
    });

    if (!content) {
      return NextResponse.json(
        { success: false, error: "The AI returned an empty analysis. Please try a different video." },
        { status: 422 }
      );
    }

    // Extract the concise prompt after "PROMPT:" if present
    let suggestedPrompt = content;
    const promptMatch = content.match(/PROMPT:\s*(.+)/i);
    if (promptMatch) {
      suggestedPrompt = promptMatch[1].trim();
    }

    return NextResponse.json({
      success: true,
      description: content,
      suggestedPrompt,
    });
  } catch (error) {
    const message = error instanceof ZAIError ? error.message : error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to analyze video:", error);
    return NextResponse.json(
      { success: false, error: "Failed to analyze video: " + message },
      { status: error instanceof ZAIError && error.kind === "auth" ? 503 : 500 }
    );
  }
}
