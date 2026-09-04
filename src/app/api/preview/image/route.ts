import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/project-auth";
import { zai } from "@/lib/zai";
import { zaiErrorResponse } from "@/lib/zai-errors";
import { applyWatermark } from "@/lib/watermark";
import { consumePreviewQuota } from "@/lib/preview-limit";
import { deductTokensForOperation } from "@/lib/tokens";
import { PRICING } from "@/lib/pricing";
import { saveGeneratedFile } from "@/lib/generated-store";

export const runtime = "nodejs";

const PREVIEW_SIZE = "1024x1024" as const;

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;
  const userId = authResult.session.userId;

  const body = await req.json().catch(() => ({}));
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const style = typeof body.style === "string" ? body.style.slice(0, 100) : "cinematic";

  if (prompt.length < 10) {
    return NextResponse.json(
      { success: false, error: "A scene description of at least 10 characters is required." },
      { status: 400 }
    );
  }
  if (prompt.length > 2000) {
    return NextResponse.json(
      { success: false, error: "Scene description is too long (max 2000 characters)." },
      { status: 400 }
    );
  }

  const quota = await consumePreviewQuota(userId, "image");
  if (!quota.ok) {
    return NextResponse.json(
      { success: false, error: quota.reason, previewQuota: quota },
      { status: 429 }
    );
  }

  const attemptId = crypto.randomUUID();
  await deductTokensForOperation({
    userId,
    operation: "preview_image",
    description: "Free watermarked image preview provider attempt",
    referenceId: attemptId,
    idempotencyKey: `preview-image:${attemptId}`,
    customTokens: 0,
    customCostUsd: PRICING.preview_image.costUsd,
  });

  const styledPrompt = `${prompt}. Visual style: ${style}, cinematic lighting, high quality, detailed.`;

  let imageBase64: string;
  try {
    imageBase64 = await zai.generateImage({
      prompt: styledPrompt,
      size: PREVIEW_SIZE,
      retry: { label: "Preview image generation", timeoutMs: 120_000, maxRetries: 3 },
    });
  } catch (err) {
    const resp = zaiErrorResponse(err, {
      session: authResult.session,
      fallbackStatus: 502,
      logLabel: "preview-image",
    });
    const responseBody = await resp.json();
    responseBody.previewQuota = quota;
    return NextResponse.json(responseBody, { status: resp.status });
  }

  let watermarkedBuffer: Buffer;
  try {
    watermarkedBuffer = await applyWatermark(Buffer.from(imageBase64, "base64"));
  } catch {
    // Provider spend already occurred; keep the quota consumed so the free-use
    // budget remains bounded even if local post-processing fails.
    return NextResponse.json(
      {
        success: false,
        error: "Failed to process preview image.",
        previewQuota: quota,
      },
      { status: 500 }
    );
  }

  const filename = `preview_${userId}_${Date.now()}_${attemptId.slice(0, 8)}.jpg`;
  const publicUrl = await saveGeneratedFile(`previews/${filename}`, watermarkedBuffer);

  return NextResponse.json({
    success: true,
    imageUrl: publicUrl,
    watermarked: true,
    previewQuota: quota,
  });
}
