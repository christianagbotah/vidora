import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/project-auth";
import { zai } from "@/lib/zai";
import { zaiErrorResponse } from "@/lib/zai-errors";
import { deductTokensForOperation } from "@/lib/tokens";
import { saveGeneratedFile } from "@/lib/generated-store";

export const runtime = "nodejs";

const SUPPORTED_SIZES = [
  "1024x1024",
  "768x1344",
  "864x1152",
  "1344x768",
  "1152x864",
  "1440x720",
  "720x1440",
] as const;

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;

  try {
    const body = await req.json();
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const size = typeof body.size === "string" ? body.size : "";

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

    const imageSize = (SUPPORTED_SIZES as readonly string[]).includes(size)
      ? size
      : "1344x768";
    const operationId = crypto.randomUUID();
    const deduction = await deductTokensForOperation({
      userId: authResult.session.userId,
      operation: "image_gen",
      description: "Generate standalone scene image",
      referenceId: operationId,
      idempotencyKey: `scene-image:${operationId}`,
    });
    if (!deduction.success) {
      return NextResponse.json(
        { success: false, error: deduction.error || "Insufficient tokens" },
        { status: 402 }
      );
    }

    const imageBase64 = await zai.generateImage({
      prompt,
      size: imageSize as (typeof SUPPORTED_SIZES)[number],
      retry: { label: "Generate scene image", timeoutMs: 120_000, maxRetries: 4 },
    });
    const imageUrl = await saveGeneratedFile(
      `scene_${Date.now()}_${operationId.slice(0, 8)}.png`,
      Buffer.from(imageBase64, "base64")
    );

    return NextResponse.json({
      success: true,
      imageUrl,
      tokensCharged: deduction.alreadyApplied ? 0 : 1,
      remainingTokens: deduction.remainingTokens,
    });
  } catch (error) {
    // Do not automatically refund ambiguous provider failures.
    return zaiErrorResponse(error, {
      session: authResult.session,
      logLabel: "generate-scene",
    });
  }
}
