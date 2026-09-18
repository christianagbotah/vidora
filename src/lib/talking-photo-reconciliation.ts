import { db } from "@/lib/db";

export const TALKING_PHOTO_RECONCILIATION_KINDS = [
  "ambiguous_submission",
  "reservation_release",
  "billing_capture",
  "billing_state",
  "provider_lookup",
  "provider_status",
  "asset_integrity",
] as const;

export type TalkingPhotoReconciliationKind =
  typeof TALKING_PHOTO_RECONCILIATION_KINDS[number];

export async function markTalkingPhotoNeedsReconciliation(opts: {
  jobId: string;
  kind: TalkingPhotoReconciliationKind;
  message: string;
}): Promise<void> {
  await db.talkingPhotoJob.update({
    where: { id: opts.jobId },
    data: {
      status: "needs_reconciliation",
      reconciliationKind: opts.kind,
      reconciliationAt: new Date(),
      reconciliationResolution: null,
      reconciledAt: null,
      reconciledByUserId: null,
      error: opts.message.slice(0, 4_000),
    },
  });
}

export async function resolveTalkingPhotoReconciliation(opts: {
  jobId: string;
  adminUserId: string;
  resolution: string;
  nextStatus: "failed" | "waiting_provider";
  releaseActiveKey?: boolean;
  error?: string | null;
}): Promise<void> {
  await db.talkingPhotoJob.update({
    where: { id: opts.jobId },
    data: {
      status: opts.nextStatus,
      ...(opts.releaseActiveKey ? { activeKey: null } : {}),
      reconciliationResolution: opts.resolution.slice(0, 4_000),
      reconciledAt: new Date(),
      reconciledByUserId: opts.adminUserId,
      error: opts.error ?? null,
    },
  });
}
