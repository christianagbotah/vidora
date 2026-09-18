import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/project-auth";
import {
  releaseReservationRemainder,
  reserveBillingQuote,
} from "@/lib/credit-reservations";
import { providerBillingErrorResponse } from "@/lib/billing-errors";
import { assertQwenTtsConfigured } from "@/lib/qwen-tts";
import { requireMatchingTalkingPhotoSpeechQuote } from "@/lib/talking-photo-speech-billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function speechActiveKey(userId: string, fingerprint: string): string {
  return `talking-photo-speech:${userId}:${fingerprint}`;
}

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const jobs = await db.talkingPhotoSpeechJob.findMany({
    where: { userId: auth.session.userId },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { outputAsset: true },
  });
  return NextResponse.json({ success: true, jobs });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  try {
    await assertQwenTtsConfigured();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
    const quoteId = typeof body.quoteId === "string" ? body.quoteId.trim() : "";
    if (!jobId || !quoteId || body.billingConfirmed !== true) {
      return NextResponse.json(
        { success: false, error: "Job, quote and explicit billing confirmation are required" },
        { status: 400 },
      );
    }

    let job = await db.talkingPhotoSpeechJob.findFirst({
      where: { id: jobId, userId: auth.session.userId },
      include: { outputAsset: true },
    });
    if (!job) {
      return NextResponse.json({ success: false, error: "Scripted speech job not found" }, { status: 404 });
    }
    if (job.status === "completed" && job.outputAsset) {
      return NextResponse.json({ success: true, job, replayed: true, asset: job.outputAsset });
    }
    if (["reserving", "queued", "processing"].includes(job.status)) {
      return NextResponse.json({ success: true, job, alreadyRunning: true }, { status: 202 });
    }
    if (job.status !== "quoted" || job.billingQuoteId !== quoteId) {
      return NextResponse.json(
        { success: false, error: "This scripted speech quote is no longer startable; review the cost again" },
        { status: 409 },
      );
    }

    await requireMatchingTalkingPhotoSpeechQuote(job);

    const conflict = await db.talkingPhotoSpeechJob.findFirst({
      where: {
        userId: auth.session.userId,
        fingerprint: job.fingerprint,
        activeKey: { not: null },
        id: { not: job.id },
      },
      select: { id: true, status: true },
    });
    if (conflict) {
      return NextResponse.json({
        success: false,
        error: "An identical scripted speech job is already active",
        activeJobId: conflict.id,
        activeStatus: conflict.status,
      }, { status: 409 });
    }

    const activeKey = speechActiveKey(auth.session.userId, job.fingerprint);
    job = await db.talkingPhotoSpeechJob.update({
      where: { id: job.id },
      data: { status: "reserving", activeKey, error: null, reconciliationKind: null },
      include: { outputAsset: true },
    });

    let reserved;
    try {
      reserved = await reserveBillingQuote({
        quoteId,
        userId: auth.session.userId,
        referenceId: job.id,
        idempotencyKey: `talking-photo-speech:${job.id}:reservation`,
      });
    } catch (error) {
      await db.talkingPhotoSpeechJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          activeKey: null,
          error: error instanceof Error ? error.message : "Speech credit reservation failed",
        },
      }).catch(() => undefined);
      throw error;
    }

    try {
      job = await db.talkingPhotoSpeechJob.update({
        where: { id: job.id },
        data: {
          creditReservationId: reserved.reservation.id,
          status: "queued",
          error: null,
        },
        include: { outputAsset: true },
      });
    } catch (error) {
      try {
        await releaseReservationRemainder({
          reservationId: reserved.reservation.id,
          userId: auth.session.userId,
          reason: "Scripted speech queue handoff failed before provider submission",
        });
        await db.talkingPhotoSpeechJob.update({
          where: { id: job.id },
          data: {
            creditReservationId: reserved.reservation.id,
            status: "failed",
            activeKey: null,
            error: "Speech job could not enter the durable queue; reserved credits were released.",
          },
        }).catch(() => undefined);
      } catch (releaseError) {
        await db.talkingPhotoSpeechJob.update({
          where: { id: job.id },
          data: {
            creditReservationId: reserved.reservation.id,
            status: "needs_reconciliation",
            reconciliationKind: "reservation_release",
            error: `Queue handoff failed and reserved credits could not be released safely: ${
              releaseError instanceof Error ? releaseError.message : "unknown release error"
            }`,
          },
        }).catch(() => undefined);
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      job,
      alreadyRunning: false,
      wallet: reserved.wallet,
    }, { status: 202 });
  } catch (error) {
    return providerBillingErrorResponse(error, {
      session: auth.session,
      fallbackStatus: 409,
      fallbackMessage: "Scripted speech could not be queued safely.",
      logLabel: "talking-photo-speech-start",
    });
  }
}
