import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/project-auth";
import { zai } from "@/lib/zai";
import { zaiErrorResponse } from "@/lib/zai-errors";
import { deductTokensForOperation } from "@/lib/tokens";

export const runtime = "nodejs";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;

  try {
    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > MAX_AUDIO_BYTES + 1024 * 1024) {
      return NextResponse.json(
        { success: false, error: "Audio upload is too large" },
        { status: 413 }
      );
    }

    const formData = await req.formData();
    const audioFile = formData.get("audio");
    if (!(audioFile instanceof File)) {
      return NextResponse.json(
        { success: false, error: "No audio file provided" },
        { status: 400 }
      );
    }
    if (audioFile.size <= 0 || audioFile.size > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        { success: false, error: "Audio file must be between 1 byte and 25 MB" },
        { status: 413 }
      );
    }
    if (audioFile.type && !audioFile.type.toLowerCase().startsWith("audio/")) {
      return NextResponse.json(
        { success: false, error: "Unsupported audio file type" },
        { status: 415 }
      );
    }

    const operationId = crypto.randomUUID();
    const deduction = await deductTokensForOperation({
      userId: authResult.session.userId,
      operation: "asr",
      description: `Transcribe audio (${Math.ceil(audioFile.size / 1024)} KB)`,
      referenceId: operationId,
      idempotencyKey: `asr:${operationId}`,
    });
    if (!deduction.success) {
      return NextResponse.json(
        { success: false, error: deduction.error || "Insufficient tokens" },
        { status: 402 }
      );
    }

    const bytes = await audioFile.arrayBuffer();
    const transcription = await zai.asr({
      fileBase64: Buffer.from(bytes).toString("base64"),
      retry: { label: "Transcribe audio", timeoutMs: 120_000, maxRetries: 3 },
    });

    return NextResponse.json({
      success: true,
      transcription,
      tokensCharged: deduction.alreadyApplied ? 0 : 1,
      remainingTokens: deduction.remainingTokens,
    });
  } catch (error) {
    // Provider timeouts can be ambiguous; do not automatically refund a
    // transcription that may already have consumed provider resources.
    return zaiErrorResponse(error, {
      session: authResult.session,
      logLabel: "transcribe",
    });
  }
}
