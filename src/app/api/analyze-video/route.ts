import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/project-auth";
import { zai } from "@/lib/zai";
import { zaiErrorResponse } from "@/lib/zai-errors";
import { deductTokensForOperation } from "@/lib/tokens";

export const runtime = "nodejs";

const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;

  try {
    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > MAX_VIDEO_BYTES + 1024 * 1024) {
      return NextResponse.json(
        { success: false, error: "Video upload is too large" },
        { status: 413 }
      );
    }

    const formData = await req.formData();
    const videoFile = formData.get("video");
    if (!(videoFile instanceof File)) {
      return NextResponse.json(
        { success: false, error: "No video file provided" },
        { status: 400 }
      );
    }
    if (videoFile.size <= 0 || videoFile.size > MAX_VIDEO_BYTES) {
      return NextResponse.json(
        { success: false, error: "Video file must be between 1 byte and 25 MB" },
        { status: 413 }
      );
    }
    if (videoFile.type && !videoFile.type.toLowerCase().startsWith("video/")) {
      return NextResponse.json(
        { success: false, error: "Unsupported video file type" },
        { status: 415 }
      );
    }

    const operationId = crypto.randomUUID();
    const deduction = await deductTokensForOperation({
      userId: authResult.session.userId,
      operation: "llm",
      description: `Analyze uploaded video (${Math.ceil(videoFile.size / 1024)} KB)`,
      referenceId: operationId,
      idempotencyKey: `vision:${operationId}`,
      customTokens: 1,
      customCostUsd: 0.01,
    });
    if (!deduction.success) {
      return NextResponse.json(
        { success: false, error: deduction.error || "Insufficient tokens" },
        { status: 402 }
      );
    }

    const bytes = await videoFile.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const mimeType = videoFile.type || "video/mp4";
    const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;

    const analyzePrompt =
      "Analyze this video and provide a detailed scene description that could be used to recreate a similar video with AI. Describe the visual style, camera work, subjects, actions, environment, lighting, mood, and color palette. Be specific and cinematic. Then on a new line starting with 'PROMPT:', provide a concise 1-2 sentence prompt that could be used for AI image generation to recreate this scene.";

    const content = await zai.vision({
      thinking: "enabled",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: analyzePrompt },
            { type: "video_url", video_url: { url: dataUrl } },
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

    const promptMatch = content.match(/PROMPT:\s*(.+)/i);
    const suggestedPrompt = promptMatch ? promptMatch[1].trim() : content;

    return NextResponse.json({
      success: true,
      description: content,
      suggestedPrompt,
      tokensCharged: deduction.alreadyApplied ? 0 : 1,
      remainingTokens: deduction.remainingTokens,
    });
  } catch (error) {
    // Do not auto-refund ambiguous provider failures. A retry is a new billable
    // analysis request unless a durable provider reconciliation record exists.
    return zaiErrorResponse(error, {
      session: authResult.session,
      logLabel: "analyze-video",
    });
  }
}
