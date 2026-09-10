import crypto from "crypto";
import { execFile } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/project-auth";
import { zaiErrorResponse } from "@/lib/zai-errors";
import { transcribeWithPricedZaiAsr } from "@/lib/zai-asr";
import { reserveMeteredZaiAsrOperation } from "@/lib/zai-metered-billing";
import { captureImmediateProviderOperation } from "@/lib/immediate-provider-billing";
import { findReservationByReference } from "@/lib/credit-reservations";

export const runtime = "nodejs";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_AUDIO_SECONDS = 30;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const execFileAsync = promisify(execFile);

async function probeAudioDuration(buffer: Buffer): Promise<number> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vidora-asr-"));
  const input = path.join(dir, "audio-upload");
  try {
    await writeFile(input, buffer);
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", input],
      { timeout: 15_000 },
    );
    const duration = Number(String(stdout).trim());
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("Could not determine audio duration");
    return duration;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;

  try {
    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > MAX_AUDIO_BYTES + 1024 * 1024) return NextResponse.json({ success: false, error: "Audio upload is too large" }, { status: 413 });

    const formData = await req.formData();
    const audioFile = formData.get("audio");
    if (!(audioFile instanceof File)) return NextResponse.json({ success: false, error: "No audio file provided" }, { status: 400 });
    if (audioFile.size <= 0 || audioFile.size > MAX_AUDIO_BYTES) return NextResponse.json({ success: false, error: "Audio file must be between 1 byte and 25 MB" }, { status: 413 });
    if (audioFile.type && !audioFile.type.toLowerCase().startsWith("audio/")) return NextResponse.json({ success: false, error: "Unsupported audio file type" }, { status: 415 });

    const bytes = Buffer.from(await audioFile.arrayBuffer());
    const durationSeconds = await probeAudioDuration(bytes);
    if (durationSeconds > MAX_AUDIO_SECONDS + 0.05) return NextResponse.json({ success: false, error: "Audio must be 30 seconds or shorter for transcription" }, { status: 413 });

    const supplied = req.headers.get("idempotency-key")?.trim() || "";
    const requestKey = IDEMPOTENCY_KEY_RE.test(supplied) ? supplied : crypto.randomUUID();
    const referenceId = `asr:${authResult.session.userId}:${requestKey}`;
    if (supplied) {
      const prior = await findReservationByReference(referenceId);
      if (prior) {
        return NextResponse.json({
          success: false,
          error: "This transcription request was already funded/submitted. Vidora will not submit it twice automatically.",
          reconciliationRequired: true,
        }, { status: 409 });
      }
    }

    const lineKey = `${referenceId}:provider`;
    const billing = await reserveMeteredZaiAsrOperation({
      userId: authResult.session.userId,
      referenceId,
      idempotencyKey: `${referenceId}:reservation`,
      lineKey,
      label: `Transcribe ${durationSeconds.toFixed(1)}s audio`,
      durationSeconds,
    });

    const transcription = await transcribeWithPricedZaiAsr({ file: audioFile, timeoutMs: 120_000 });
    if (transcription.model !== billing.model) throw new Error("ASR provider model changed after billing reservation");
    const capture = await captureImmediateProviderOperation({
      reservationId: billing.reservation.id,
      lineKey,
      userId: authResult.session.userId,
    });

    return NextResponse.json({
      success: true,
      transcription: transcription.text,
      durationSeconds,
      providerModel: transcription.model,
      tokensCharged: capture.alreadyCaptured ? 0 : capture.creditsCaptured,
      remainingTokens: billing.wallet.availableCredits,
    });
  } catch (error) {
    return zaiErrorResponse(error, { session: authResult.session, logLabel: "transcribe" });
  }
}
