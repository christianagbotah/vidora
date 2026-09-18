import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/project-auth";
import { assertFalTalkingPhotoConfigured } from "@/lib/fal-lipsync";
import {
  getBillingQuote,
  releaseReservationRemainder,
  reserveBillingQuote,
} from "@/lib/credit-reservations";
import {
  requireMatchingTalkingPhotoQuote,
  talkingPhotoActiveKey,
} from "@/lib/talking-photo-billing";
import { markTalkingPhotoNeedsReconciliation } from "@/lib/talking-photo-reconciliation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const jobs = await db.talkingPhotoJob.findMany({
    where: { userId: auth.session.userId },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      imageAsset: { select: { id: true, originalName: true, url: true } },
      audioAsset: { select: { id: true, originalName: true, url: true, durationSeconds: true } },
    },
  });
  return NextResponse.json({ success: true, jobs });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  try {
    assertFalTalkingPhotoConfigured();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const imageAssetId = typeof body.imageAssetId === "string" ? body.imageAssetId.trim() : "";
    const audioAssetId = typeof body.audioAssetId === "string" ? body.audioAssetId.trim() : "";
    const quoteId = typeof body.quoteId === "string" ? body.quoteId.trim() : "";
    if (!imageAssetId || !audioAssetId || !quoteId) {
      return NextResponse.json({ success: false, error: "Talking Photo media and quote are required" }, { status: 400 });
    }
    if (body.consentConfirmed !== true || body.billingConfirmed !== true) {
      return NextResponse.json({
        success: false,
        error: "Confirm that you have permission to animate this person/photo and explicitly approve the displayed charge.",
        code: "TALKING_PHOTO_CONFIRMATION_REQUIRED",
      }, { status: 409 });
    }

    const [image, audio, quote] = await Promise.all([
      db.mediaAsset.findFirst({
        where: { id: imageAssetId, userId: auth.session.userId, kind: "image" },
      }),
      db.mediaAsset.findFirst({
        where: { id: audioAssetId, userId: auth.session.userId, kind: "audio" },
      }),
      getBillingQuote(quoteId),
    ]);
    if (!image || !audio || !quote) {
      return NextResponse.json({ success: false, error: "Talking Photo media or quote is unavailable" }, { status: 404 });
    }
    if (!audio.durationSeconds || audio.durationSeconds <= 0 || audio.durationSeconds > 600) {
      return NextResponse.json({ success: false, error: "Audio duration is unavailable or invalid" }, { status: 409 });
    }
    requireMatchingTalkingPhotoQuote({
      quote,
      userId: auth.session.userId,
      imageAssetId: image.id,
      audioAssetId: audio.id,
      durationSeconds: audio.durationSeconds,
    });

    const activeKey = talkingPhotoActiveKey(auth.session.userId, image.id, audio.id);
    const existing = await db.talkingPhotoJob.findUnique({ where: { activeKey } });
    if (existing) {
      return NextResponse.json({
        success: true,
        job: existing,
        alreadyRunning: true,
        message: "This Talking Photo is already queued or running.",
      });
    }

    const jobId = crypto.randomUUID();
    let job;
    try {
      job = await db.talkingPhotoJob.create({
        data: {
          id: jobId,
          userId: auth.session.userId,
          imageAssetId: image.id,
          audioAssetId: audio.id,
          activeKey,
          status: "reserving",
          durationSeconds: audio.durationSeconds,
          consentConfirmedAt: new Date(),
          billingQuoteId: quote.id,
        },
      });
    } catch (error) {
      const raced = await db.talkingPhotoJob.findUnique({ where: { activeKey } });
      if (raced) {
        return NextResponse.json({ success: true, job: raced, alreadyRunning: true });
      }
      throw error;
    }

    let reserved;
    try {
      reserved = await reserveBillingQuote({
        quoteId: quote.id,
        userId: auth.session.userId,
        referenceId: job.id,
        idempotencyKey: `talking-photo-job:${job.id}`,
      });
    } catch (error) {
      await db.talkingPhotoJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          activeKey: null,
          error: error instanceof Error ? error.message : "Credit reservation failed",
        },
      }).catch(() => undefined);
      throw error;
    }

    try {
      job = await db.talkingPhotoJob.update({
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
          reason: "Talking Photo queue handoff failed before any provider submission",
        });
        await db.talkingPhotoJob.update({
          where: { id: job.id },
          data: {
            status: "failed",
            activeKey: null,
            creditReservationId: reserved.reservation.id,
            error: "Job could not enter the durable provider queue; reserved credits were released.",
          },
        }).catch(() => undefined);
      } catch (releaseError) {
        await db.talkingPhotoJob.update({
          where: { id: job.id },
          data: { creditReservationId: reserved.reservation.id },
        }).catch(() => undefined);
        await markTalkingPhotoNeedsReconciliation({
          jobId: job.id,
          kind: "reservation_release",
          message: `Queue handoff failed and reserved credits could not be released safely: ${
            releaseError instanceof Error ? releaseError.message : "unknown release error"
          }`,
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
      error: error instanceof Error ? error.message : "Unable to queue Talking Photo",
      code: "TALKING_PHOTO_START_FAILED",
    }, { status: 409 });
  }
}
