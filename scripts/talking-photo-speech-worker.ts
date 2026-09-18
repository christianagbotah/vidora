import crypto from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import {
  captureReservedQuoteLine,
  findReservationByReference,
  releaseReservationRemainder,
} from "@/lib/credit-reservations";
import {
  assertQwenTtsConfigured,
  splitQwenTtsInput,
  synthesizeQwenTts,
} from "@/lib/qwen-tts";
import {
  audioFileExists,
  deleteAudioFile,
  ensureAudioDir,
  getAudioPath,
  writeAudioFile,
} from "@/lib/audio-storage";
import { concatWavChunks } from "@/lib/narration";
import { probeTalkingPhotoAudio } from "@/lib/photo-studio-audio";
import { saveGeneratedFile } from "@/lib/generated-store";
import { talkingPhotoSpeechLineKey } from "@/lib/talking-photo-speech-billing";

const IDLE_MS = Math.max(1_000, Number(process.env.TALKING_PHOTO_SPEECH_WORKER_IDLE_MS || 3_000));
const STALE_MINUTES = Math.max(1, Number(process.env.TALKING_PHOTO_SPEECH_WORKER_STALE_MINUTES || 3));
let stopping = false;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkFilename(jobId: string, index: number, extension: "wav" | "mp3"): string {
  return `talking_photo_speech_${jobId}_${String(index).padStart(3, "0")}.${extension}`;
}

function existingChunkPath(jobId: string, index: number): string | null {
  for (const extension of ["wav", "mp3"] as const) {
    const filename = chunkFilename(jobId, index, extension);
    if (audioFileExists(filename)) return getAudioPath(filename);
  }
  return null;
}

async function markReconciliation(jobId: string, kind: string, message: string): Promise<void> {
  await db.talkingPhotoSpeechJob.update({
    where: { id: jobId },
    data: {
      status: "needs_reconciliation",
      reconciliationKind: kind,
      error: message.slice(0, 4_000),
    },
  });
}

async function recoverStaleReservations(): Promise<void> {
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
          error: "Speech reservation handoff was interrupted before credits moved.",
        },
      });
      continue;
    }
    if (reservation.capturedCredits > 0 || reservation.status === "captured") {
      await db.talkingPhotoSpeechJob.update({
        where: { id: job.id },
        data: { creditReservationId: reservation.id },
      });
      await markReconciliation(
        job.id,
        "billing_state",
        "Stale pre-provider speech job unexpectedly has captured credits.",
      );
      continue;
    }
    try {
      await releaseReservationRemainder({
        reservationId: reservation.id,
        userId: job.userId,
        reason: "Recovered stale scripted-speech reservation before provider submission",
      });
      await db.talkingPhotoSpeechJob.update({
        where: { id: job.id },
        data: {
          creditReservationId: reservation.id,
          status: "failed",
          activeKey: null,
          error: "Speech reservation handoff was interrupted; reserved credits were safely released.",
        },
      });
    } catch (error) {
      await db.talkingPhotoSpeechJob.update({
        where: { id: job.id },
        data: { creditReservationId: reservation.id },
      });
      await markReconciliation(
        job.id,
        "reservation_release",
        `Stale speech reservation could not be safely released: ${
          error instanceof Error ? error.message : "unknown release error"
        }`,
      );
    }
  }
}

async function claimJob(): Promise<string | null> {
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

async function createSpeechAsset(job: {
  id: string;
  userId: string;
}, finalPath: string) {
  const buffer = await readFile(finalPath);
  const probe = await probeTalkingPhotoAudio(buffer);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const existing = await db.mediaAsset.findUnique({
    where: { userId_sha256: { userId: job.userId, sha256 } },
  });
  if (existing) {
    if (existing.kind !== "audio") {
      throw new Error("Generated speech hash collides with a non-audio media asset");
    }
    return existing.durationSeconds
      ? existing
      : db.mediaAsset.update({
          where: { id: existing.id },
          data: { durationSeconds: probe.durationSeconds },
        });
  }

  const url = await saveGeneratedFile(
    `users/${job.userId}/photo-studio/audio/scripted-${job.id}.wav`,
    buffer,
  );
  return db.mediaAsset.create({
    data: {
      userId: job.userId,
      kind: "audio",
      source: "qwen-tts",
      originalName: `Scripted speech ${job.id.slice(0, 8)}.wav`,
      mimeType: "audio/wav",
      sizeBytes: buffer.length,
      url,
      sha256,
      durationSeconds: probe.durationSeconds,
    },
  });
}

async function runJob(jobId: string): Promise<void> {
  const job = await db.talkingPhotoSpeechJob.findUnique({ where: { id: jobId } });
  if (!job || !job.activeKey) return;
  if (!job.creditReservationId) {
    await markReconciliation(job.id, "billing_state", "Scripted speech job is missing its credit reservation.");
    return;
  }

  await assertQwenTtsConfigured();
  const chunks = splitQwenTtsInput(job.scriptText);
  if (!chunks.length || chunks.length !== job.chunkCount) {
    await markReconciliation(job.id, "input_integrity", "Scripted speech chunks changed after billing confirmation.");
    return;
  }

  ensureAudioDir();
  const chunkPaths: string[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const existingPath = existingChunkPath(job.id, index);
    const capture = await captureReservedQuoteLine({
      reservationId: job.creditReservationId,
      lineKey: talkingPhotoSpeechLineKey(job.id, index),
      userId: job.userId,
    });

    if (existingPath) {
      chunkPaths.push(existingPath);
      await db.talkingPhotoSpeechJob.update({
        where: { id: job.id },
        data: { completedChunks: Math.max(job.completedChunks, index + 1) },
      });
      continue;
    }

    if (capture.alreadyCaptured) {
      await markReconciliation(
        job.id,
        "captured_without_artifact",
        `Speech part ${index + 1} was already captured but its deterministic audio artifact is missing. Automatic Qwen resubmission is blocked.`,
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
        model: job.model,
      });
    } catch (error) {
      await markReconciliation(
        job.id,
        "provider_submission",
        `Speech part ${index + 1} crossed the prepaid provider boundary but no durable audio artifact was saved: ${
          error instanceof Error ? error.message : "unknown provider error"
        }`,
      );
      return;
    }
    if (speech.model !== job.model) {
      await markReconciliation(
        job.id,
        "model_drift",
        "Qwen execution model changed after the scripted-speech quote was reserved.",
      );
      return;
    }

    const filename = chunkFilename(job.id, index, speech.extension);
    const saved = writeAudioFile(filename, speech.buffer);
    chunkPaths.push(saved);
    await db.talkingPhotoSpeechJob.update({
      where: { id: job.id },
      data: { completedChunks: index + 1, error: null },
    });
  }

  const finalFilename = `talking_photo_speech_final_${job.id}.wav`;
  const finalPath = getAudioPath(finalFilename);
  try {
    const concatenated = await concatWavChunks(chunkPaths, finalPath);
    if (!concatenated) throw new Error("FFmpeg could not assemble the preserved speech chunks");
    const asset = await createSpeechAsset(job, finalPath);
    await db.talkingPhotoSpeechJob.update({
      where: { id: job.id },
      data: {
        status: "completed",
        activeKey: null,
        outputAssetId: asset.id,
        completedChunks: chunks.length,
        error: null,
        reconciliationKind: null,
      },
    });
    for (const chunkPath of chunkPaths) deleteAudioFile(path.basename(chunkPath));
    deleteAudioFile(finalFilename);
  } catch (error) {
    await db.talkingPhotoSpeechJob.update({
      where: { id: job.id },
      data: {
        status: "processing",
        error: `Local speech assembly failed; preserved chunks will be reused on retry: ${
          error instanceof Error ? error.message : "unknown local error"
        }`,
      },
    });
  }
}

async function runForever(): Promise<void> {
  console.log("[talking-photo-speech-worker] started (durable Qwen scripted speech queue)");
  while (!stopping) {
    let jobId: string | null = null;
    try {
      await recoverStaleReservations();
      jobId = await claimJob();
      if (!jobId) {
        await sleep(IDLE_MS);
        continue;
      }
      await runJob(jobId);
    } catch (error) {
      console.error(
        `[talking-photo-speech-worker] ${jobId ? `job=${jobId} ` : ""}error`,
        error instanceof Error ? error.message : "unknown error",
      );
      if (jobId) {
        await markReconciliation(
          jobId,
          "worker_error",
          `Scripted speech worker stopped in an unknown state; automatic provider resubmission is blocked: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        ).catch(() => undefined);
      }
      await sleep(IDLE_MS);
    }
  }
  await db.$disconnect();
  console.log("[talking-photo-speech-worker] stopped");
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

runForever().catch(async (error) => {
  console.error("[talking-photo-speech-worker] fatal", error instanceof Error ? error.message : "unknown error");
  await db.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
