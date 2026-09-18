import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";

function read(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("Talking Photo reconciliation controls", () => {
  test("schema records structured quarantine and operator resolution audit fields", () => {
    const schema = read("prisma/schema.prisma");
    const migration = read("prisma/migrations/20260918153500_talking_photo_reconciliation/migration.sql");
    expect(schema).toContain("reconciliationKind");
    expect(schema).toContain("reconciliationAt");
    expect(schema).toContain("reconciliationResolution");
    expect(schema).toContain("reconciledAt");
    expect(schema).toContain("reconciledByUserId");
    expect(schema).toContain("@@index([reconciliationKind, reconciliationAt])");
    expect(migration).toContain('"TalkingPhotoJob_reconciliationKind_reconciliationAt_idx"');
  });

  test("shared state helper resets stale resolution audit data when quarantining", () => {
    const helper = read("src/lib/talking-photo-reconciliation.ts");
    expect(helper).toContain('"ambiguous_submission"');
    expect(helper).toContain('"reservation_release"');
    expect(helper).toContain('"billing_capture"');
    expect(helper).toContain('"provider_lookup"');
    expect(helper).toContain('"asset_integrity"');
    expect(helper).toContain('status: "needs_reconciliation"');
    expect(helper).toContain("reconciliationResolution: null");
    expect(helper).toContain("reconciledAt: null");
    expect(helper).toContain("reconciledByUserId: null");
  });

  test("worker classifies ambiguous provider POSTs and never auto-resubmits them", () => {
    const worker = read("scripts/talking-photo-worker.ts");
    expect(worker).toContain("markTalkingPhotoNeedsReconciliation");
    expect(worker).toContain('kind: "ambiguous_submission"');
    expect(worker).toContain('"reconciliationKind" = \'ambiguous_submission\'');
    expect(worker).toContain("Automatic resubmission is blocked");
    expect(worker).toContain('kind: "billing_capture"');
    expect(worker).toContain('kind: "reservation_release"');
    expect(worker).toContain('kind: "provider_lookup"');
    expect(worker).toContain('kind: "provider_status"');
    expect(worker).toContain('kind: "asset_integrity"');
  });

  test("admin API is admin-only and exposes only state-specific actions", () => {
    const route = read("src/app/api/admin/talking-photo/reconciliation/route.ts");
    expect(route).toContain("requireAdmin(req)");
    expect(route).toContain('case "reservation_release"');
    expect(route).toContain('return ["retry_release"]');
    expect(route).toContain('case "ambiguous_submission"');
    expect(route).toContain('return ["confirm_not_submitted_release"]');
    expect(route).toContain('case "billing_capture"');
    expect(route).toContain('"retry_billing_capture"');
    expect(route).toContain('"retry_provider_status"');
    expect(route).toContain('where: { status: "needs_reconciliation" }');
  });

  test("credit release fails closed after provider acceptance or capture", () => {
    const route = read("src/app/api/admin/talking-photo/reconciliation/route.ts");
    expect(route).toContain("if (job.providerTaskId)");
    expect(route).toContain("Credits cannot be released automatically after a provider request id exists");
    expect(route).toContain("reservation.capturedCredits > 0");
    expect(route).toContain("Captured provider credits cannot be released");
    expect(route).toContain("body.confirmedNoProviderWork !== true");
    expect(route).toContain("provider console shows no accepted work");
  });

  test("billing capture recovery is bound to the persisted request and original line", () => {
    const route = read("src/app/api/admin/talking-photo/reconciliation/route.ts");
    expect(route).toContain('job.reconciliationKind !== "billing_capture"');
    expect(route).toContain("!job.providerTaskId");
    expect(route).toContain("captureReservedQuoteLine({");
    expect(route).toContain("talkingPhotoLineKey(job.imageAssetId, job.audioAssetId)");
    expect(route).toContain("providerTaskId: job.providerTaskId");
    expect(route).toContain('nextStatus: "waiting_provider"');
  });

  test("provider status retry never invents completion and keeps unknown states quarantined", () => {
    const route = read("src/app/api/admin/talking-photo/reconciliation/route.ts");
    expect(route).toContain("getFalTalkingPhotoStatus(job.providerTaskId)");
    expect(route).toContain('status === "FAILED" || status === "CANCELLED"');
    expect(route).toContain('["IN_QUEUE", "IN_PROGRESS", "COMPLETED"].includes(status)');
    expect(route).toContain("Provider returned unrecognized status");
    expect(route).toContain("reconciliation remains locked");
  });

  test("admin console requires an exact deliberate phrase for ambiguous release", () => {
    const page = read("src/app/admin/talking-photo/reconciliation/page.tsx");
    const billing = read("src/app/admin/billing/page.tsx");
    expect(page).toContain("Type NO PROVIDER WORK");
    expect(page).toContain('confirmation !== "NO PROVIDER WORK"');
    expect(page).toContain("confirmedNoProviderWork");
    expect(page).toContain("No automated money-moving action is permitted");
    expect(billing).toContain("/admin/talking-photo/reconciliation");
  });

  test("runtime contract requires reconciliation columns and index", () => {
    const runtime = read("scripts/check-runtime-db-contract.ts");
    expect(runtime).toContain("'reconciliationKind','reconciliationAt','reconciliationResolution'");
    expect(runtime).toContain("'reconciledAt','reconciledByUserId','updatedAt'");
    expect(runtime).toContain("TalkingPhotoJob_reconciliationKind_reconciliationAt_idx");
  });
});
