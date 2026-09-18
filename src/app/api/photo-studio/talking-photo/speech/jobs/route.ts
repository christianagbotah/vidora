import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/project-auth";
import {
  normalizeTalkingPhotoSpeechSpec,
  requireMatchingTalkingPhotoSpeechQuote,
} from "@/lib/talking-photo-speech-billing";
import {
  releaseReservationRemainder,
  reserveBillingQuote,
} from "@/lib/credit-reservations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function activeKey(userId: string, fingerprint: string): string {
  return `talking-photo-speech:${userId}:${fingerprint}`;
}

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const jobs = await db.talkingPhotoSpeechJob.findMany({
    where: { userId: auth.session.userId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return NextResponse.json({ success: true, jobs });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const quoteId = typeof body.quoteId === "string" ? body.quoteId.trim() : "";
    if (!quoteId) {
      return NextResponse.json({ success: false, error: "Voice quote is required" }, { status: 400 });
    }
    if (body.billingConfirmed !== true) {
      return NextResponse.json({
        success: false,
        error: "Explicitly approve the displayed Qwen voice charge before generation.",
        code: "DIGITAL_ACTOR_VOICE_CONFIRMATION_REQUIRED",
      }, { status: 409 });
    }

    const spec = normalizeTalkingPhotoSpeechSpec(body);
    const matched = await requireMatchingTalkingPhotoSpeechQuote({
      quoteId,
      userId: auth.session.userId,
      spec,
    });
    const completed = await db.talkingPhotoSpeechJob.findFirst({
      where: {
        userId: auth.session.userId,
        scriptSha256: matched.fingerprint,
        providerModel: matched.model,
        status: "completed",
        outputAssetId: { not: null },
      },
      orderBy: { createdAt: "desc" },
    });
    if (completed?.outputAssetId) {
      const outputAsset = await db.mediaAsset.findFirst({
        where: {
          id: completed.outputAssetId,
          userId: auth.session.userId,
          kind: "audio",
        },
        select: { id: true },
      });
      if (outputAsset) {
        return NextResponse.json({
          success: true,
          job: completed,
          alreadyRunning: false,
          replayed: true,
          message: "This exact Digital Actor voice already exists and was reused without another charge.",
        });
      }
    }

    const key = activeKey(auth.session.userId, matched.fingerprint);
    const existing = await db.talkingPhotoSpeechJob.findUnique({ where: { activeKey: key } });
    if (existing) {
      return NextResponse.json({
        success: true,
        job: existing,
        alreadyRunning: true,
        message: "This exact Digital Actor voice is already queued or running.",
      });
    }

    const jobId = crypto.randomUUID();
    let job;
    try {
      job = await db.talkingPhotoSpeechJob.create({
        data: {
          id: jobId,
          userId: auth.session.userId,
          activeKey: key,
          status: "reserving",
          script: spec.script,
          scriptSha256: matched.fingerprint,
          voice: spec.voice,
          language: spec.language,
          accent: spec.accent,
          style: spec.style,
          providerModel: matched.model,
          billingQuoteId: matched.quote.id,
          chunkCount: matched.chunks.length,
        },
      });
    } catch (error) {
      const raced = await db.talkingPhotoSpeechJob.findUnique({ where: { activeKey: key } });
      if (raced) return NextResponse.json({ success: true, job: raced, alreadyRunning: true });
      throw error;
    }

    let reserved;
    try {
      reserved = await reserveBillingQuote({
        quoteId: matched.quote.id,
        userId: auth.session.userId,
        referenceId: job.id,
        idempotencyKey: `talking-photo-speech-job:${job.id}`,
      });
    } catch (error) {
      await db.talkingPhotoSpeechJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          activeKey: null,
          error: error instanceof Error ? error.message : "Voice credit reservation failed",
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
      });
    } catch (error) {
      try {
        await releaseReservationRemainder({
          reservationId: reserved.reservation.id,
          userId: auth.session.userId,
          reason: "Digital Actor voice queue handoff failed before any Qwen submission",
        });
        await db.talkingPhotoSpeechJob.update({
          where: { id: job.id },
          data: {
            creditReservationId: reserved.reservation.id,
            status: "failed",
            activeKey: null,
            error: "Voice job could not enter the durable queue; reserved credits were released.",
          },
        }).catch(() => undefined);
      } catch (releaseError) {
        await db.talkingPhotoSpeechJob.update({
          where: { id: job.id },
          data: {
            creditReservationId: reserved.reservation.id,
            status: "needs_reconciliation",
            error: `Voice queue handoff failed and reserved credits could not be released safely: ${
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
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unable to queue Digital Actor voice",
      code: "DIGITAL_ACTOR_VOICE_START_FAILED",
    }, { status: 409 });
  }
}
