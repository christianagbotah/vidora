import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/project-auth";
import { zai } from "@/lib/zai";
import { zaiErrorResponse } from "@/lib/zai-errors";
import {
  captureMeteredZaiVisionOperation,
  reserveMeteredZaiVisionOperation,
} from "@/lib/zai-metered-billing";

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

    const bytes = await videoFile.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const mimeType = videoFile.type || "video/mp4";
    const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;

    const analyzePrompt =
      "Analyze this video and provide a detailed scene description that could be used to recreate a similar video with AI. Describe the visual style, camera work, subjects, actions, environment, lighting, mood, and color palette. Be specific and cinematic. Then on a new line starting with 'PROMPT:', provide a concise 1-2 sentence prompt that could be used for AI image generation to recreate this scene.";

    const operationId = crypto.randomUUID();
    const lineKeyPrefix = `vision:${operationId}`;
    const billing = await reserveMeteredZaiVisionOperation({
      userId: authResult.session.userId,
      referenceId: operationId,
      idempotencyKey: `${lineKeyPrefix}:reservation`,
      lineKeyPrefix,
      label: `Analyze uploaded video (${Math.ceil(videoFile.size / 1024)} KB)`,
      maxOutputTokens: 3_000,
    });
    const captures = await captureMeteredZaiVisionOperation({
      reservationId: billing.reservation.id,
      lineKeyPrefix,
      userId: authResult.session.userId,
    });

    const content = await zai.vision({
      model: billing.model,
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
    const tokensCharged = captures.reduce(
      (sum, capture) => sum + (capture.alreadyCaptured ? 0 : capture.creditsCaptured),
      0,
    );

    return NextResponse.json({
      success: true,
      description: content,
      suggestedPrompt,
      providerModel: billing.model,
      tokensCharged,
      remainingTokens: billing.wallet.availableCredits,
    });
  } catch (error) {
    return zaiErrorResponse(error, {
      session: authResult.session,
      logLabel: "analyze-video",
    });
  }
}
