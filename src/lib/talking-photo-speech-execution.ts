import crypto from "crypto";
import path from "path";
import { readFile } from "fs/promises";
import { db } from "@/lib/db";
import {
  captureReservedQuoteLine,
  findReservationByReference,
  releaseReservationRemainder,
} from "@/lib/credit-reservations";
import {
  talkingPhotoSpeechChunks,
  talkingPhotoSpeechFingerprint,
  talkingPhotoSpeechLineKey,
  type TalkingPhotoSpeechSpec,
} from "@/lib/talking-photo-speech-billing";
import { synthesizeQwenTts } from "@/lib/qwen-tts";
import {
  audioFileExists,
  deleteAudioFile,
  getAudioPath,
  writeAudioFile,
} from "@/lib/audio-storage";
import { concatWavChunks } from "@/lib/narration";
import { probeTalkingPhotoAudio } from "@/lib/photo-studio-audio";
import { saveGeneratedFile } from "@/lib/generated-store";

const STALE_MINUTES = Math.max(1, Number(process.env.TALKING_PHOTO_WORKER_STALE_MINUTES || 3));

function chunkFilename(jobId: string, index: number, extension: "wav" | "mp3"): string {
  return `talking_photo_speech_${jobId}_${String(index).padStart(3, "0")}.${extension}`;
}

function existingChunk(jobId: string, index: number): string | null {
  for (const extension of ["wav", "mp3"] as const) {
    const filename = chunkFilename(jobId, index, extension);
    if (audioFileExists(filename)) return getAudioPath(filename);
  }
  return null;
}

function finalFilename(jobId: string): string {
  return `talking_photo_speech_${jobId}_final.wav`;
}

async function failReconciliation(jobId: string, message: string): Promise<void> {
  await db.talkingPhotoSpeechJob.update({
    where: { id: jobId },
    data: {
      status: "needs_reconciliation",
      error: message.slice(0, 4_000),
    },
  });
}

export async function recoverStaleTalkingPhotoSpeechReservations(): Promise<void> {
  const stale = await db.talkingPhotoSpeechJob.findMany({
    where: {
      status: "reserving",
      activeKey: { not: null },
      updatedAt: { lt: new Date(Date.now() - STALE_MINUTES * 60_000) },
    },
    select: { id: true, userId: true },
    take: 25,
  });

  for (const job of stale) {
    const reservation = await findReservationByReference(job.id);
    if (!reservation) {
      await db.talkingPhotoSpeechJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          activeKey: null,
          error: "Voice reservation handoff stopped before credits moved.",
        },
      });
      continue;
    }
    if (reservation.capturedCredits > 0 || reservation.status === "captured") {
      await failReconciliation(
        job.id,
        "A stale Digital Actor voice job already has captured credits and requires billing reconciliation.",
      );
      continue;
    }
    try {
      await releaseReservationRemainder({
        reservationId: reservation.id,
        userId: job.userId,
        reason: "Recovered stale Digital Actor voice reservation before Qwen submission",
      });
      await db.talkingPhotoSpeechJob.update({
        where: { id: job.id },
        data: {
          creditReservationId: reservation.id,
          status: "failed",
          activeKey: null,
          error: "Interrupted voice reservation was safely released.",
        },
      });
    } catch (error) {
      await db.talkingPhotoSpeechJob.update({
        where: { id: job.id },
        data: {
          creditReservationId: reservation.id,
          status: "needs_reconciliation",
          error: `Interrupted voice reservation could not be released safely: ${
            error instanceof Error ? error.message : "unknown release error"
          }`,
        },
      });
    }
  }
}

export async function claimTalkingPhotoSpeechJob(): Promise<string | null> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "TalkingPhotoSpeechJob"
      WHERE "activeKey" IS NOT NULL
        AND (
          "status" = 'queued'
          OR (
            "status" = 'processing'
            AND "updatedAt" < NOW() - (${STALE_MINUTES} * INTERVAL '1 minute')
          )
        )
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;
    const id = rows[0]?.id;
    if (!id) return null;
    await tx.talkingPhotoSpeechJob.update({
      where: { id },
      data: { status: "processing", error: null },
    });
    return id;
  });
}

function speechSpec(job: {
  script: string;
  voice: string;
  language: string | null;
  accent: string | null;
  style: string | null;
}): TalkingPhotoSpeechSpec {
  return {
    script: job.script,
    voice: job.voice,
    language: job.language,
    accent: job.accent,
    style: job.style,
  };
}

export async function runTalkingPhotoSpeechJob(jobId: string): Promise<void> {
  const job = await db.talkingPhotoSpeechJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  if (!job.creditReservationId) {
    await failReconciliation(job.id, "Digital Actor voice job is missing its credit reservation.");
    return;
  }

  const spec = speechSpec(job);
  const fingerprint = talkingPhotoSpeechFingerprint(spec, job.providerModel);
  if (fingerprint !== job.scriptSha256) {
    await failReconciliation(job.id, "Digital Actor script or voice settings changed after billing reservation.");
    return;
  }
  const chunks = talkingPhotoSpeechChunks(job.script);
  if (chunks.length !== job.chunkCount || chunks.length === 0) {
    await failReconciliation(job.id, "Digital Actor speech chunk plan changed after billing reservation.");
    return;
  }

  const chunkPaths: string[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const lineKey = talkingPhotoSpeechLineKey(fingerprint, index);
    const existing = existingChunk(job.id, index);
    if (existing) {
      await captureReservedQuoteLine({
        reservationId: job.creditReservationId,
        lineKey,
        userId: job.userId,
      });
      chunkPaths.push(existing);
      continue;
    }

    const capture = await captureReservedQuoteLine({
      reservationId: job.creditReservationId,
      lineKey,
      userId: job.userId,
    });
    if (capture.alreadyCaptured) {
      await failReconciliation(
        job.id,
        `Voice part ${index + 1} was previously funded but its deterministic audio artifact is missing. Automatic Qwen resubmission is blocked.`,
      );
      return;
    }

    let speech;
    try {
      speech = await synthesizeQwenTts({
        input: chunks[index],
        voice: job.voice,
        language: job.language,
        accent: job.accent,
        direction: job.style,
        model: job.providerModel,
      });
    } catch (error) {
      await failReconciliation(
        job.id,
        `Qwen voice part ${index + 1} crossed the billing boundary but no deterministic audio artifact was saved. Automatic resubmission is blocked: ${
          error instanceof Error ? error.message : "unknown provider error"
        }`,
      );
      return;
    }
    if (speech.model !== job.providerModel) {
      await failReconciliation(job.id, "Qwen execution model drifted from the prepaid voice quote.");
      return;
    }

    const filename = chunkFilename(job.id, index, speech.extension);
    chunkPaths.push(writeAudioFile(filename, speech.buffer));
  }

  const outputName = finalFilename(job.id);
  const outputPath = getAudioPath(outputName);
  const assembled = await concatWavChunks(chunkPaths, outputPath);
  if (!assembled) {
    await db.talkingPhotoSpeechJob.update({
      where: { id: job.id },
      data: {
        status: "queued",
        error: "Qwen voice parts are preserved, but final audio assembly failed. Retry will reuse them without another provider call.",
      },
    });
    return;
  }

  try {
    const buffer = await readFile(outputPath);
    const probe = await probeTalkingPhotoAudio(buffer);
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const existingAsset = await db.mediaAsset.findUnique({
      where: { userId_sha256: { userId: job.userId, sha256 } },
    });
    let outputAssetId: string;
    if (existingAsset) {
      if (existingAsset.kind !== "audio") {
        await failReconciliation(job.id, "Generated speech hash already exists as a non-audio asset.");
        return;
      }
      outputAssetId = existingAsset.id;
    } else {
      const url = await saveGeneratedFile(
        `users/${job.userId}/photo-studio/audio/${sha256}.${probe.extension}`,
        buffer,
      );
      const asset = await db.mediaAsset.create({
        data: {
          userId: job.userId,
          kind: "audio",
          source: "qwen_tts",
          originalName: `Digital Actor voice ${job.id.slice(0, 8)}.${probe.extension}`,
          mimeType: probe.mimeType,
          sizeBytes: buffer.length,
          url,
          sha256,
          durationSeconds: probe.durationSeconds,
        },
      });
      outputAssetId = asset.id;
    }

    await db.talkingPhotoSpeechJob.update({
      where: { id: job.id },
      data: {
        status: "completed",
        activeKey: null,
        outputAssetId,
        error: null,
      },
    });
  } finally {
    deleteAudioFile(outputName);
    for (const chunkPath of chunkPaths) deleteAudioFile(path.basename(chunkPath));
  }
}
