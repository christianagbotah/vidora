import { describe, expect, test } from "bun:test";
import {
  canAutoReconcileReferenceDownloadFailure,
  generationRunSceneIds,
  isExplicitReferenceDownloadFailure,
} from "../../src/lib/generation-reconciliation";

const baseRun = {
  status: "needs_reconciliation",
  activeKey: "project:p1",
  totalTokens: 21,
  chargeTransactionId: "charge-1",
  refundTransactionId: null,
  sceneIds: JSON.stringify(["s1", "s2"]),
  targetSceneId: null,
};

const baseScenes = [
  { id: "s1", status: "failed", taskId: null, videoUrl: null, errorMessage: "image download fail" },
  { id: "s2", status: "queued", taskId: null, videoUrl: null, errorMessage: null },
];

describe("generation reconciliation safety", () => {
  test("reconstructs persisted run scope and legacy target scope", () => {
    expect(generationRunSceneIds(baseRun)).toEqual(["s1", "s2"]);
    expect(generationRunSceneIds({ sceneIds: "not-json", targetSceneId: "legacy" })).toEqual(["legacy"]);
  });

  test("recognizes raw and friendly reference download failures", () => {
    expect(isExplicitReferenceDownloadFailure("image download fail")).toBe(true);
    expect(isExplicitReferenceDownloadFailure("Failed to download image from URL")).toBe(true);
    expect(isExplicitReferenceDownloadFailure("The AI rendering service could not download this scene's reference image.")).toBe(true);
    expect(isExplicitReferenceDownloadFailure("network timeout")).toBe(false);
  });

  test("allows retry only when no provider task/video exists", () => {
    expect(canAutoReconcileReferenceDownloadFailure(baseRun, baseScenes)).toEqual({
      safe: true,
      sceneIds: ["s1", "s2"],
    });

    const withTask = baseScenes.map((scene) => ({ ...scene }));
    withTask[0].taskId = "provider-task";
    expect(canAutoReconcileReferenceDownloadFailure(baseRun, withTask).safe).toBe(false);

    const submitting = baseScenes.map((scene) => ({ ...scene }));
    submitting[1].status = "submitting";
    expect(canAutoReconcileReferenceDownloadFailure(baseRun, submitting).safe).toBe(false);
  });

  test("keeps ambiguous and unrelated provider failures fail-closed", () => {
    const timeout = baseScenes.map((scene) => ({ ...scene }));
    timeout[0].errorMessage = "Provider network timeout";
    expect(canAutoReconcileReferenceDownloadFailure(baseRun, timeout).safe).toBe(false);

    expect(canAutoReconcileReferenceDownloadFailure(
      { ...baseRun, status: "processing" },
      baseScenes
    ).safe).toBe(false);

    expect(canAutoReconcileReferenceDownloadFailure(
      { ...baseRun, chargeTransactionId: null },
      baseScenes
    ).safe).toBe(false);
  });

  test("permits a previously recorded idempotent refund even if charge link is absent", () => {
    expect(canAutoReconcileReferenceDownloadFailure(
      { ...baseRun, chargeTransactionId: null, refundTransactionId: "refund-1" },
      baseScenes
    ).safe).toBe(true);
  });
});
