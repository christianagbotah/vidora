import { db } from "@/lib/db";
import {
  captureReservedQuoteLine,
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

async function quarantineAmbiguousSubmissions(): Promise<void> {
  await db.$executeRaw`
    UPDATE "TalkingPhotoJob"
    SET "status" = 'needs_reconciliation',
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

async function markNeedsReconciliation(jobId: string, message: string): Promise<void> {
  await db.talkingPhotoJob.update({
    where: { id: jobId },
    data: { status: "needs_reconciliation", error: message.slice(0, 4_000) },
  });
}

function providerDefinitelyRejected(error: unknown): boolean {
  return error instanceof FalProviderError
    && typeof error.status === "number"
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
      await markNeedsReconciliation(
        job.id,
        `Provider rejected before acceptance, but reserved credits could not be released safely: ${
          releaseError instanceof Error ? releaseError.message : "unknown release error"
        }`,
      );
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
    await markNeedsReconciliation(
      job.id,
      `fal returned unrecognized status ${provider.status}; automatic resubmission is blocked.`,
    );
  } catch (error) {
    if (error instanceof FalProviderError && error.status === 404) {
      await markNeedsReconciliation(
        job.id,
        "fal no longer recognizes the persisted provider request id; manual reconciliation is required.",
      );
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
    await markNeedsReconciliation(job.id, "Talking Photo job is missing its credit reservation.");
    return;
  }
  if (!job.audioAsset.durationSeconds || Math.abs(job.audioAsset.durationSeconds - job.durationSeconds) > 0.01) {
    await markNeedsReconciliation(job.id, "Stored audio duration changed after billing reservation.");
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
    if (providerDefinitelyRejected(error)) {
      await failBeforeProviderAcceptance(job, message);
      return;
    }
    await markNeedsReconciliation(
      job.id,
      `Provider submission outcome is ambiguous and will not be retried automatically: ${message}`,
    );
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
    await markNeedsReconciliation(
      job.id,
      `fal accepted request ${submitted.requestId}, but billing capture needs reconciliation: ${
        error instanceof Error ? error.message : "unknown capture error"
      }`,
    );
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
    await markNeedsReconciliation(job.id, "Talking Photo source asset ownership/type verification failed.");
    return;
  }

  if (job.providerTaskId) {
    await pollAcceptedJob({ id: job.id, providerTaskId: job.providerTaskId });
    return;
  }
  await submitNewJob(job);
}

async function runForever(): Promise<void> {
  console.log("[talking-photo-worker] started (durable fal lip-sync queue)");
  while (!stopping) {
    let jobId: string | null = null;
    try {
      await quarantineAmbiguousSubmissions();
      jobId = await claimJob();
      if (!jobId) {
        await sleep(IDLE_MS);
        continue;
      }
      await runJob(jobId);
    } catch (error) {
      console.error(
        `[talking-photo-worker] ${jobId ? `job=${jobId} ` : ""}error`,
        error instanceof Error ? error.message : "unknown error",
      );
      if (jobId) {
        await db.talkingPhotoJob.update({
          where: { id: jobId },
          data: {
            status: "processing",
            error: `Worker error: ${error instanceof Error ? error.message : "unknown error"}`,
          },
        }).catch(() => undefined);
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
