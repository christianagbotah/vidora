import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { requireSceneAccess } from "@/lib/project-auth";
import { generateSceneNarration, TTS_VOICES } from "@/lib/narration";
import { deductTokensForOperation, refundTokens } from "@/lib/tokens";
import { zaiErrorResponse } from "@/lib/zai-errors";

export const runtime = "nodejs";

function requestOperationKey(req: NextRequest, userId: string): string {
  const supplied = req.headers.get("idempotency-key")?.trim();
  if (supplied && /^[A-Za-z0-9._:-]{8,128}$/.test(supplied)) {
    return `tts:${userId}:${supplied}`;
  }
  return `tts:${userId}:${crypto.randomUUID()}`;
}

export async function POST(req: NextRequest) {
  let charged:
    | { userId: string; amount: number; operationKey: string; transactionId?: string }
    | null = null;

  try {
    const body = await req.json();
    const sceneId = typeof body.sceneId === "string" ? body.sceneId : "";
    if (!sceneId) {
      return NextResponse.json(
        { success: false, error: "Scene ID is required" },
        { status: 400 }
      );
    }

    const authResult = await requireSceneAccess(sceneId, true);
    if (!authResult.ok) return authResult.response;

    const scene = await db.videoScene.findUnique({ where: { id: sceneId } });
    if (!scene) {
      return NextResponse.json({ success: false, error: "Scene not found" }, { status: 404 });
    }
    if (body.projectId && String(body.projectId) !== scene.projectId) {
      return NextResponse.json(
        { success: false, error: "Scene does not belong to the supplied project" },
        { status: 400 }
      );
    }

    const narrationText = typeof body.text === "string" && body.text.trim()
      ? body.text.trim()
      : scene.dialogue?.trim() || "";
    if (!narrationText) {
      return NextResponse.json(
        { success: false, error: "No narration text provided and scene has no dialogue" },
        { status: 400 }
      );
    }
    if (narrationText.length > 12_000) {
      return NextResponse.json(
        { success: false, error: "Narration text is too long" },
        { status: 413 }
      );
    }

    const voice = typeof body.voice === "string" ? body.voice.toLowerCase() : "tongtong";
    const speed = Number(body.speed ?? 1);
    if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) {
      return NextResponse.json({ success: false, error: "Invalid narration speed" }, { status: 400 });
    }

    const operationKey = requestOperationKey(req, authResult.session.userId);
    const deduction = await deductTokensForOperation({
      userId: authResult.session.userId,
      operation: "tts",
      description: `Generate narration for scene ${sceneId}`,
      referenceId: sceneId,
      idempotencyKey: operationKey,
    });
    if (!deduction.success) {
      return NextResponse.json(
        { success: false, error: deduction.error || "Insufficient tokens" },
        { status: 402 }
      );
    }

    // A retried HTTP request with the same Idempotency-Key must not call the
    // billable provider twice after the first result was already persisted.
    if (deduction.alreadyApplied && scene.narrationUrl) {
      return NextResponse.json({
        success: true,
        narrationUrl: scene.narrationUrl,
        text: narrationText,
        voice: scene.narrationVoice || voice,
        replayed: true,
        remainingTokens: deduction.remainingTokens,
      });
    }

    charged = {
      userId: authResult.session.userId,
      amount: 1,
      operationKey,
      transactionId: deduction.transactionId,
    };

    const result = await generateSceneNarration({
      sceneId,
      text: narrationText,
      voice,
      speed,
    });

    await db.videoScene.update({
      where: { id: sceneId },
      data: { narrationUrl: result.url, narrationVoice: voice },
    });

    return NextResponse.json({
      success: true,
      narrationUrl: result.url,
      text: narrationText,
      voice,
      chunks: result.chunks,
      concatenated: result.concatenated,
      remainingTokens: deduction.remainingTokens,
    });
  } catch (error) {
    if (charged) {
      await refundTokens({
        userId: charged.userId,
        amount: charged.amount,
        description: "Refund: narration generation failed",
        operation: "tts",
        idempotencyKey: `${charged.operationKey}:refund`,
        relatedTransactionId: charged.transactionId,
      }).catch(() => undefined);
    }
    return zaiErrorResponse(error, {
      session: charged
        ? { userId: charged.userId, role: "user", email: "" }
        : null,
      logLabel: "generate-narration",
    });
  }
}

export async function GET() {
  return NextResponse.json({ success: true, voices: TTS_VOICES });
}
