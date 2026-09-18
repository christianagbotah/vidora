import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import {
  captureReservedQuoteLine,
  releaseReservationRemainder,
} from "@/lib/credit-reservations";
import {
  FalProviderError,
  getFalTalkingPhotoStatus,
} from "@/lib/fal-lipsync";
import { talkingPhotoLineKey } from "@/lib/talking-photo-billing";
import {
  resolveTalkingPhotoReconciliation,
  type TalkingPhotoReconciliationKind,
} from "@/lib/talking-photo-reconciliation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AdminAction =
  | "retry_release"
  | "confirm_not_submitted_release"
  | "retry_billing_capture"
  | "retry_provider_status";

function allowedActions(kind: string | null): AdminAction[] {
  switch (kind as TalkingPhotoReconciliationKind | null) {
    case "reservation_release":
      return ["retry_release"];
    case "ambiguous_submission":
      return ["confirm_not_submitted_release"];
    case "billing_capture":
      return ["retry_billing_capture", "retry_provider_status"];
    case "provider_lookup":
    case "provider_status":
      return ["retry_provider_status"];
    default:
      return [];
  }
}

async function reservationForJob(job: {
  id: string;
  creditReservationId: string | null;
}) {
  if (job.creditReservationId) {
    return db.creditReservation.findUnique({
      where: { id: job.creditReservationId },
      include: {
        quote: {
          select: {
            id: true,
            creditsRequired: true,
            customerPriceUsd: true,
            providerCostUsd: true,
            pricingVersion: true,
          },
        },
      },
    });
  }
  return db.creditReservation.findFirst({
    where: { referenceId: job.id },
    orderBy: { createdAt: "desc" },
    include: {
      quote: {
        select: {
          id: true,
          creditsRequired: true,
          customerPriceUsd: true,
          providerCostUsd: true,
          pricingVersion: true,
        },
      },
    },
  });
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (admin.error) return admin.error;

  const jobs = await db.talkingPhotoJob.findMany({
    where: { status: "needs_reconciliation" },
    orderBy: [
      { reconciliationAt: "asc" },
      { updatedAt: "asc" },
    ],
    take: 100,
    include: {
      user: { select: { id: true, email: true, name: true } },
      imageAsset: { select: { id: true, originalName: true, url: true } },
      audioAsset: {
        select: {
          id: true,
          originalName: true,
          url: true,
          durationSeconds: true,
        },
      },
    },
  });

  const reservations = await Promise.all(jobs.map((job) => reservationForJob(job)));
  return NextResponse.json({
    success: true,
    jobs: jobs.map((job, index) => ({
      ...job,
      reservation: reservations[index],
      allowedActions: allowedActions(job.reconciliationKind),
    })),
  });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (admin.error) return admin.error;

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
    const action = typeof body.action === "string" ? body.action.trim() as AdminAction : null;
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 1_000) : "";
    if (!jobId || !action) {
      return NextResponse.json(
        { success: false, error: "Job and reconciliation action are required" },
        { status: 400 },
      );
    }

    const job = await db.talkingPhotoJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== "needs_reconciliation") {
      return NextResponse.json(
        { success: false, error: "Talking Photo reconciliation job was not found" },
        { status: 404 },
      );
    }
    if (!allowedActions(job.reconciliationKind).includes(action)) {
      return NextResponse.json(
        {
          success: false,
          error: `Action ${action} is not permitted for reconciliation kind ${job.reconciliationKind || "unknown"}`,
        },
        { status: 409 },
      );
    }

    const reservation = await reservationForJob(job);

    if (action === "retry_release" || action === "confirm_not_submitted_release") {
      if (job.providerTaskId) {
        return NextResponse.json(
          { success: false, error: "Credits cannot be released automatically after a provider request id exists" },
          { status: 409 },
        );
      }
      if (!reservation) {
        return NextResponse.json(
          { success: false, error: "The job has no reservation to release; inspect billing state manually" },
          { status: 409 },
        );
      }
      if (reservation.capturedCredits > 0 || reservation.status === "captured") {
        return NextResponse.json(
          { success: false, error: "Captured provider credits cannot be released by this reconciliation action" },
          { status: 409 },
        );
      }
      if (
        action === "confirm_not_submitted_release"
        && body.confirmedNoProviderWork !== true
      ) {
        return NextResponse.json(
          {
            success: false,
            error: "Explicitly confirm that the provider console shows no accepted work for this ambiguous submission",
          },
          { status: 409 },
        );
      }

      const released = await releaseReservationRemainder({
        reservationId: reservation.id,
        userId: job.userId,
        reason: action === "confirm_not_submitted_release"
          ? "Admin confirmed ambiguous Talking Photo submission was not accepted by provider"
          : "Admin retried known pre-provider Talking Photo reservation release",
      });
      await resolveTalkingPhotoReconciliation({
        jobId: job.id,
        adminUserId: admin.currentUser.id,
        nextStatus: "failed",
        releaseActiveKey: true,
        resolution: [
          action === "confirm_not_submitted_release"
            ? "Admin confirmed no provider work existed and released the reservation."
            : "Known pre-provider reservation release retried successfully.",
          `creditsReleased=${released.creditsReleased}`,
          note ? `note=${note}` : "",
        ].filter(Boolean).join(" "),
        error: action === "confirm_not_submitted_release"
          ? "Provider submission was confirmed absent; reserved credits were released."
          : "Reserved credits were released after reconciliation.",
      });
      return NextResponse.json({
        success: true,
        action,
        jobId: job.id,
        creditsReleased: released.creditsReleased,
      });
    }

    if (action === "retry_billing_capture") {
      if (
        job.reconciliationKind !== "billing_capture"
        || !job.providerTaskId
        || !reservation
      ) {
        return NextResponse.json(
          { success: false, error: "A persisted provider request and reservation are required to retry billing capture" },
          { status: 409 },
        );
      }
      const captured = await captureReservedQuoteLine({
        reservationId: reservation.id,
        lineKey: talkingPhotoLineKey(job.imageAssetId, job.audioAssetId),
        userId: job.userId,
        providerTaskId: job.providerTaskId,
      });
      await resolveTalkingPhotoReconciliation({
        jobId: job.id,
        adminUserId: admin.currentUser.id,
        nextStatus: "waiting_provider",
        resolution: [
          "Billing capture retried idempotently for the persisted provider request.",
          `creditsCaptured=${captured.creditsCaptured}`,
          `alreadyCaptured=${captured.alreadyCaptured}`,
          note ? `note=${note}` : "",
        ].filter(Boolean).join(" "),
      });
      return NextResponse.json({
        success: true,
        action,
        jobId: job.id,
        creditsCaptured: captured.creditsCaptured,
        alreadyCaptured: captured.alreadyCaptured,
      });
    }

    if (action === "retry_provider_status") {
      if (!job.providerTaskId) {
        return NextResponse.json(
          { success: false, error: "A persisted provider request id is required to retry provider status" },
          { status: 409 },
        );
      }
      const provider = await getFalTalkingPhotoStatus(job.providerTaskId);
      const status = provider.status.toUpperCase();
      if (status === "FAILED" || status === "CANCELLED") {
        await resolveTalkingPhotoReconciliation({
          jobId: job.id,
          adminUserId: admin.currentUser.id,
          nextStatus: "failed",
          releaseActiveKey: true,
          resolution: [
            `Provider status rechecked as ${status}; accepted provider work remains billable.`,
            note ? `note=${note}` : "",
          ].filter(Boolean).join(" "),
          error: `fal Talking Photo ended with provider status ${status}`,
        });
        return NextResponse.json({ success: true, action, jobId: job.id, providerStatus: status });
      }
      if (["IN_QUEUE", "IN_PROGRESS", "COMPLETED"].includes(status)) {
        await resolveTalkingPhotoReconciliation({
          jobId: job.id,
          adminUserId: admin.currentUser.id,
          nextStatus: "waiting_provider",
          resolution: [
            `Provider request recovered with status ${status}; worker polling resumed.`,
            note ? `note=${note}` : "",
          ].filter(Boolean).join(" "),
        });
        return NextResponse.json({ success: true, action, jobId: job.id, providerStatus: status });
      }
      return NextResponse.json(
        {
          success: false,
          error: `Provider returned unrecognized status ${provider.status}; reconciliation remains locked`,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ success: false, error: "Unsupported reconciliation action" }, { status: 400 });
  } catch (error) {
    const providerConfig = error instanceof FalProviderError && error.code === "FAL_KEY_MISSING";
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Talking Photo reconciliation failed",
        code: error instanceof FalProviderError ? error.code : "TALKING_PHOTO_RECONCILIATION_FAILED",
      },
      { status: providerConfig ? 503 : 409 },
    );
  }
}
