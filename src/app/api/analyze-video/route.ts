import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { writeFile, unlink, readFile } from "fs/promises";
import path from "path";
import os from "os";

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

    // Save to temp file
    const ext = videoFile.name.split(".").pop() || "mp4";
    tempPath = path.join(os.tmpdir(), `video_${Date.now()}.${ext}`);
    await writeFile(tempPath, buffer);

    const zai = await ZAI.create();

    const analyzePrompt =
      "Analyze this video and provide a detailed scene description that could be used to recreate a similar video with AI. Describe: the visual style, camera work, subjects, actions, environment, lighting, mood, and color palette. Be specific and cinematic. Also provide a concise 1-2 sentence prompt that could be used for AI image generation to recreate this scene.";

    const response = await zai.chat.completions.createVision({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: analyzePrompt },
            {
              type: "video_url",
              video_url: { url: `file://${tempPath}` },
            },
          ],
        },
      ],
      thinking: { type: "enabled" },
    });

    const content = response.choices[0]?.message?.content;

    if (!content) {
      return NextResponse.json(
        { success: false, error: "Failed to analyze video" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      description: content,
      suggestedPrompt: content,
    });
  } catch (error) {
    console.error("Failed to analyze video:", error);
    return NextResponse.json(
      { success: false, error: "Failed to analyze video" },
      { status: 500 }
    );
  } finally {
    if (tempPath) {
      try {
        await unlink(tempPath);
      } catch {}
    }
  }
}
