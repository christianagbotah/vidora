import { db } from "@/lib/db";
import {
  captureReservedQuoteLine,
  findReservationByReference,
  releaseReservationRemainder,
} from "@/lib/credit-reservations";
import {
  FalProviderError,
  getFalTalkingPhotoResult,
  getFalTalkingPhotoStatus,
  submitFalTalkingPhoto,
} from "@/lib/fal-lipsync";
import { persistProviderVideo } from "@/lib/provider-video-storage";
import { toSignedProviderMediaUrl } from "@/lib/provider-media-access";
import { talkingPhotoLineKey } from "@/lib/talking-photo-billing";
import { markTalkingPhotoNeedsReconciliation } from "@/lib/talking-photo-reconciliation";
import {
  claimTalkingPhotoSpeechJob,
  recoverStaleTalkingPhotoSpeechReservations,
  runTalkingPhotoSpeechJob,
} from "@/lib/talking-photo-speech-execution";

const IDLE_MS = Math.max(1_000, Number(process.env.TALKING_PHOTO_WORKER_IDLE_MS || 3_000));
const STALE_MINUTES = Math.max(1, Number(process.env.TALKING_PHOTO_WORKER_STALE_MINUTES || 3));
let stopping = false;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function publicOrigin(): string {
  const value = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || "").trim().replace(/\/$/, "");
  if (!value) throw new Error("Talking Photo worker requires NEXT_PUBLIC_BASE_URL or NEXTAUTH_URL");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") throw new Error("Talking Photo provider origin must use HTTPS");
  return parsed.origin;
}

async function recoverStaleReservations(): Promise<void> {
  const stale = await db.talkingPhotoJob.findMany({
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
      await db.talkingPhotoJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          activeKey: null,
          error: "Reservation handoff was interrupted before credits moved; the job was safely released.",
        },
      });
      continue;
    }

    if (reservation.capturedCredits > 0 || reservation.status === "captured") {
      await markTalkingPhotoNeedsReconciliation({
        jobId: job.id,
        kind: "billing_state",
        message: "A stale pre-provider job unexpectedly has captured credits; manual billing reconciliation is required.",
      });
      continue;
    }

    try {
      await releaseReservationRemainder({
        reservationId: reservation.id,
        userId: job.userId,
        reason: "Recovered stale Talking Photo reservation before any provider submission",
      });
      await db.talkingPhotoJob.update({
        where: { id: job.id },
        data: {
          creditReservationId: reservation.id,
          status: "failed",
          activeKey: null,
          error: "Reservation handoff was interrupted; reserved credits were safely released.",
        },
      });
    } catch (error) {
      await db.talkingPhotoJob.update({
        where: { id: job.id },
        data: { creditReservationId: reservation.id },
      });
      await markTalkingPhotoNeedsReconciliation({
        jobId: job.id,
        kind: "reservation_release",
        message: `Stale reservation could not be safely released: ${
          error instanceof Error ? error.message : "unknown release error"
        }`,
      });
    }
  }
}

async function quarantineAmbiguousSubmissions(): Promise<void> {
  await db.$executeRaw`
    UPDATE "TalkingPhotoJob"
    SET "status" = 'needs_reconciliation',
        "reconciliationKind" = 'ambiguous_submission',
        "reconciliationAt" = CURRENT_TIMESTAMP,
        "reconciliationResolution" = NULL,
        "reconciledAt" = NULL,
        "reconciledByUserId" = NULL,
        "error" = 'Provider submission was interrupted before the request id was durably recorded. Automatic resubmission is blocked.',
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "status" = 'submitting'
      AND "activeKey" IS NOT NULL
      AND "updatedAt" < NOW() - (${STALE_MINUTES} * INTERVAL '1 minute')
  `;
}

async function claimJob(): Promise<string | null> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "TalkingPhotoJob"
      WHERE "activeKey" IS NOT NULL
        AND (
          "status" IN ('queued', 'waiting_provider')
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
    await tx.talkingPhotoJob.update({ where: { id }, data: { status: "processing", error: null } });
    return id;
  });
}

function providerDefinitelyNotSubmitted(error: unknown): boolean {
  if (!(error instanceof FalProviderError)) return false;
  if (["FAL_KEY_MISSING", "FAL_INPUT_URL_INVALID", "FAL_INPUT_URL_UNSAFE"].includes(error.code)) {
    return true;
  }
  return typeof error.status === "number"
    && error.status >= 400
    && error.status < 500
    && error.status !== 408
    && error.status !== 429;
}

async function failBeforeProviderAcceptance(
  job: { id: string; userId: string; creditReservationId: string | null },
  message: string,
): Promise<void> {
  if (job.creditReservationId) {
    try {
      await releaseReservationRemainder({
        reservationId: job.creditReservationId,
        userId: job.userId,
        reason: "Talking Photo provider rejected the request before accepting work",
      });
    } catch (releaseError) {
      await markTalkingPhotoNeedsReconciliation({
        jobId: job.id,
        kind: "reservation_release",
        message: `Provider rejected before acceptance, but reserved credits could not be released safely: ${
          releaseError instanceof Error ? releaseError.message : "unknown release error"
        }`,
      });
      return;
    }
  }
  await db.talkingPhotoJob.update({
    where: { id: job.id },
    data: { status: "failed", activeKey: null, error: message.slice(0, 4_000) },
  });
}

async function completeProviderJob(jobId: string, requestId: string): Promise<void> {
  const result = await getFalTalkingPhotoResult(requestId);
  const localVideoUrl = await persistProviderVideo(jobId, result.videoUrl);
  await db.talkingPhotoJob.update({
    where: { id: jobId },
    data: { status: "completed", activeKey: null, videoUrl: localVideoUrl, error: null },
  });
}

async function pollAcceptedJob(job: { id: string; providerTaskId: string }): Promise<void> {
  try {
    const provider = await getFalTalkingPhotoStatus(job.providerTaskId);
    const status = provider.status.toUpperCase();
    if (status === "COMPLETED") {
      await completeProviderJob(job.id, job.providerTaskId);
      return;
    }
    if (status === "FAILED" || status === "CANCELLED") {
      await db.talkingPhotoJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          activeKey: null,
          error: `fal Talking Photo ended with provider status ${status}`,
        },
      });
      return;
    }
    if (status === "IN_QUEUE" || status === "IN_PROGRESS") {
      await db.talkingPhotoJob.update({
        where: { id: job.id },
        data: { status: "waiting_provider", error: null },
      });
      return;
    }
    await markTalkingPhotoNeedsReconciliation({
      jobId: job.id,
      kind: "provider_status",
      message: `fal returned unrecognized status ${provider.status}; automatic resubmission is blocked.`,
    });
  } catch (error) {
    if (error instanceof FalProviderError && error.status === 404) {
      await markTalkingPhotoNeedsReconciliation({
        jobId: job.id,
        kind: "provider_lookup",
        message: "fal no longer recognizes the persisted provider request id; manual reconciliation is required.",
      });
      return;
    }
    await db.talkingPhotoJob.update({
      where: { id: job.id },
      data: {
        status: "waiting_provider",
        error: `Temporary provider status check failed: ${error instanceof Error ? error.message : "unknown error"}`,
      },
    });
  }
}

async function submitNewJob(job: {
  id: string;
  userId: string;
  imageAssetId: string;
  audioAssetId: string;
  durationSeconds: number;
  creditReservationId: string | null;
  imageAsset: { url: string };
  audioAsset: { url: string; durationSeconds: number | null };
}): Promise<void> {
  if (!job.creditReservationId) {
    await markTalkingPhotoNeedsReconciliation({
      jobId: job.id,
      kind: "billing_state",
      message: "Talking Photo job is missing its credit reservation.",
    });
    return;
  }
  if (!job.audioAsset.durationSeconds || Math.abs(job.audioAsset.durationSeconds - job.durationSeconds) > 0.01) {
    await markTalkingPhotoNeedsReconciliation({
      jobId: job.id,
      kind: "asset_integrity",
      message: "Stored audio duration changed after billing reservation.",
    });
    return;
  }

  const origin = publicOrigin();
  const imageUrl = toSignedProviderMediaUrl(job.imageAsset.url, origin);
  const audioUrl = toSignedProviderMediaUrl(job.audioAsset.url, origin);
  if (!imageUrl || !audioUrl) {
    await failBeforeProviderAcceptance(
      job,
      "Talking Photo source media could not be exposed through a safe provider capability URL.",
    );
    return;
  }

  await db.talkingPhotoJob.update({
    where: { id: job.id },
    data: { status: "submitting", error: null, updatedAt: new Date() },
  });

  let submitted;
  try {
    submitted = await submitFalTalkingPhoto({ imageUrl, audioUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "fal submission failed";
    if (providerDefinitelyNotSubmitted(error)) {
      await failBeforeProviderAcceptance(job, message);
      return;
    }
    await markTalkingPhotoNeedsReconciliation({
      jobId: job.id,
      kind: "ambiguous_submission",
      message: `Provider submission outcome is ambiguous and will not be retried automatically: ${message}`,
    });
    return;
  }

  await db.talkingPhotoJob.update({
    where: { id: job.id },
    data: { providerTaskId: submitted.requestId, status: "waiting_provider", error: null },
  });

  try {
    await captureReservedQuoteLine({
      reservationId: job.creditReservationId,
      lineKey: talkingPhotoLineKey(job.imageAssetId, job.audioAssetId),
      userId: job.userId,
      providerTaskId: submitted.requestId,
    });
  } catch (error) {
    await markTalkingPhotoNeedsReconciliation({
      jobId: job.id,
      kind: "billing_capture",
      message: `fal accepted request ${submitted.requestId}, but billing capture needs reconciliation: ${
        error instanceof Error ? error.message : "unknown capture error"
      }`,
    });
  }
}

async function ensureAcceptedJobCaptured(job: {
  id: string;
  userId: string;
  imageAssetId: string;
  audioAssetId: string;
  creditReservationId: string | null;
  providerTaskId: string;
}): Promise<boolean> {
  if (!job.creditReservationId) {
    await markTalkingPhotoNeedsReconciliation({
      jobId: job.id,
      kind: "billing_state",
      message: `fal request ${job.providerTaskId} is persisted but its credit reservation id is missing.`,
    });
    return false;
  }
  try {
    await captureReservedQuoteLine({
      reservationId: job.creditReservationId,
      lineKey: talkingPhotoLineKey(job.imageAssetId, job.audioAssetId),
      userId: job.userId,
      providerTaskId: job.providerTaskId,
    });
    return true;
  } catch (error) {
    await markTalkingPhotoNeedsReconciliation({
      jobId: job.id,
      kind: "billing_capture",
      message: `fal request ${job.providerTaskId} exists, but billing capture needs reconciliation: ${
        error instanceof Error ? error.message : "unknown capture error"
      }`,
    });
    return false;
  }
}

async function runJob(jobId: string): Promise<void> {
  const job = await db.talkingPhotoJob.findUnique({
    where: { id: jobId },
    include: {
      imageAsset: { select: { url: true, kind: true, userId: true } },
      audioAsset: { select: { url: true, kind: true, userId: true, durationSeconds: true } },
    },
  });
  if (!job) return;
  if (
    job.imageAsset.kind !== "image" ||
    job.audioAsset.kind !== "audio" ||
    job.imageAsset.userId !== job.userId ||
    job.audioAsset.userId !== job.userId
  ) {
    await markTalkingPhotoNeedsReconciliation({
      jobId: job.id,
      kind: "asset_integrity",
      message: "Talking Photo source asset ownership/type verification failed.",
    });
    return;
  }

  if (job.providerTaskId) {
    const captured = await ensureAcceptedJobCaptured({
      id: job.id,
      userId: job.userId,
      imageAssetId: job.imageAssetId,
      audioAssetId: job.audioAssetId,
      creditReservationId: job.creditReservationId,
      providerTaskId: job.providerTaskId,
    });
    if (!captured) return;
    await pollAcceptedJob({ id: job.id, providerTaskId: job.providerTaskId });
    return;
  }
  await submitNewJob(job);
}

async function runForever(): Promise<void> {
  console.log("[talking-photo-worker] started (durable fal lip-sync queue)");
  while (!stopping) {
    let jobId: string | null = null;
    let speechJobId: string | null = null;
    try {
      await recoverStaleReservations();
      await recoverStaleTalkingPhotoSpeechReservations();
      await quarantineAmbiguousSubmissions();

      speechJobId = await claimTalkingPhotoSpeechJob();
      if (speechJobId) {
        await runTalkingPhotoSpeechJob(speechJobId);
        speechJobId = null;
      }

      jobId = await claimJob();
      if (!jobId) {
        await sleep(IDLE_MS);
        continue;
      }
      await runJob(jobId);
    } catch (error) {
      console.error(
        `[talking-photo-worker] ${speechJobId ? `speechJob=${speechJobId} ` : jobId ? `job=${jobId} ` : ""}error`,
        error instanceof Error ? error.message : "unknown error",
      );
      if (speechJobId) {
        await db.talkingPhotoSpeechJob.update({
          where: { id: speechJobId },
          data: {
            status: "processing",
            error: `Worker interrupted Digital Actor voice processing. Durable chunk/billing checks will decide whether retry is safe: ${
              error instanceof Error ? error.message : "unknown error"
            }`,
          },
        }).catch(() => undefined);
      } else if (jobId) {
        const current = await db.talkingPhotoJob.findUnique({
          where: { id: jobId },
          select: { status: true, providerTaskId: true },
        }).catch(() => null);
        if (current?.status === "submitting" && !current.providerTaskId) {
          await markTalkingPhotoNeedsReconciliation({
            jobId,
            kind: "ambiguous_submission",
            message: `Worker interrupted an in-flight provider submission; automatic resubmission is blocked: ${
              error instanceof Error ? error.message : "unknown error"
            }`,
          }).catch(() => undefined);
        } else if (current?.providerTaskId) {
          await db.talkingPhotoJob.update({
            where: { id: jobId },
            data: {
              status: "waiting_provider",
              error: `Worker recovery will poll the persisted provider request: ${
                error instanceof Error ? error.message : "unknown error"
              }`,
            },
          }).catch(() => undefined);
        } else {
          await db.talkingPhotoJob.update({
            where: { id: jobId },
            data: {
              status: "processing",
              error: `Worker error before provider submission: ${
                error instanceof Error ? error.message : "unknown error"
              }`,
            },
          }).catch(() => undefined);
        }
      }
      await sleep(IDLE_MS);
    }
  }
  await db.$disconnect();
  console.log("[talking-photo-worker] stopped");
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

runForever().catch(async (error) => {
  console.error("[talking-photo-worker] fatal", error instanceof Error ? error.message : "unknown error");
  await db.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
