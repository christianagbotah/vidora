import { describe, expect, test } from "bun:test";
import {
  canRecoverHeldProviderRun,
  canRetryTerminalProviderFailure,
} from "../../src/lib/generation-reconciliation";

const run = {
  status: "needs_reconciliation",
  activeKey: "project:p1",
  totalTokens: 21,
  chargeTransactionId: "charge-1",
  refundTransactionId: null,
  sceneIds: JSON.stringify(["s1", "s2"]),
  targetSceneId: null,
};

describe("terminal provider retry safety", () => {
  test("retries failed and never-submitted scenes without touching completed scenes", () => {
    const result = canRetryTerminalProviderFailure(run, [
      { id: "s1", status: "failed", taskId: "task-1", videoUrl: null, errorMessage: "provider task failed" },
      { id: "s2", status: "queued", taskId: null, videoUrl: null, errorMessage: null },
    ]);
    expect(result.safe).toBe(true);
    expect(result.retrySceneIds).toEqual(["s1", "s2"]);
  });

  test("keeps ambiguous in-flight provider work locked in terminal-only mode", () => {
    const result = canRetryTerminalProviderFailure(run, [
      { id: "s1", status: "failed", taskId: "task-1", videoUrl: null, errorMessage: "provider task failed" },
      { id: "s2", status: "generating", taskId: "task-2", videoUrl: null, errorMessage: null },
    ]);
    expect(result.safe).toBe(false);
  });

  test("does not resubmit completed scenes", () => {
    const result = canRetryTerminalProviderFailure(run, [
      { id: "s1", status: "completed", taskId: "task-1", videoUrl: "/generated/s1.mp4", errorMessage: null },
      { id: "s2", status: "failed", taskId: "task-2", videoUrl: null, errorMessage: "provider task failed" },
    ]);
    expect(result.safe).toBe(true);
    expect(result.retrySceneIds).toEqual(["s2"]);
  });
});

describe("held provider run recovery", () => {
  test("preserves in-flight task IDs and queues only terminal/never-submitted scenes", () => {
    const result = canRecoverHeldProviderRun(run, [
      { id: "s1", status: "generating", taskId: "task-1", videoUrl: null, errorMessage: null },
      { id: "s2", status: "queued", taskId: null, videoUrl: null, errorMessage: null },
    ]);
    expect(result.safe).toBe(true);
    expect(result.preserveTaskSceneIds).toEqual(["s1"]);
    expect(result.queueSceneIds).toEqual(["s2"]);
  });

  test("resubmits only definitively failed task IDs under the original charge", () => {
    const result = canRecoverHeldProviderRun(run, [
      { id: "s1", status: "failed", taskId: "task-1", videoUrl: null, errorMessage: "provider task failed" },
      { id: "s2", status: "completed", taskId: "task-2", videoUrl: "/generated/s2.mp4", errorMessage: null },
    ]);
    expect(result.safe).toBe(true);
    expect(result.preserveTaskSceneIds).toEqual([]);
    expect(result.queueSceneIds).toEqual(["s1"]);
  });

  test("rejects ambiguous failed scenes without a provider task ID", () => {
    const result = canRecoverHeldProviderRun(run, [
      { id: "s1", status: "failed", taskId: null, videoUrl: null, errorMessage: "unknown provider submission error" },
      { id: "s2", status: "queued", taskId: null, videoUrl: null, errorMessage: null },
    ]);
    expect(result.safe).toBe(false);
  });

  test("rejects recovery after the original Vidora charge has been refunded", () => {
    const result = canRecoverHeldProviderRun(
      { ...run, refundTransactionId: "refund-1" },
      [
        { id: "s1", status: "generating", taskId: "task-1", videoUrl: null, errorMessage: null },
        { id: "s2", status: "queued", taskId: null, videoUrl: null, errorMessage: null },
      ],
    );
    expect(result.safe).toBe(false);
  });
});
