import { describe, expect, test } from "bun:test";
import {
  EXPECTED_DURABLE_WORKER_TARGETS,
  EXPECTED_VIDORA_PM2_APPS,
  evaluateDurableWorkerTargets,
  evaluatePm2Processes,
  evaluateWorkerHeartbeat,
} from "../../scripts/check-pm2-health";
import type { WorkerHeartbeatRecord } from "../../scripts/worker-heartbeat";

function row(name: string, status: string, pid = 1000, pmExecPath?: string) {
  return {
    name,
    pid,
    pm2_env: {
      status,
      restart_time: 0,
      unstable_restarts: 0,
      ...(pmExecPath ? { pm_exec_path: pmExecPath } : {}),
    },
  };
}

function heartbeat(
  worker: WorkerHeartbeatRecord["worker"],
  pid: number,
  checkedAtMs: number,
): WorkerHeartbeatRecord {
  return { worker, pid, checkedAtMs };
}

describe("Vidora PM2 deployment health", () => {
  test("passes process state only when web and all durable workers are online", () => {
    const result = evaluatePm2Processes([
      row("vidora", "online", 1001),
      row("vidora-generation-worker", "online", 1002),
      row("vidora-export-worker", "online", 1003),
      row("vidora-talking-photo-worker", "online", 1004),
      row("unrelated-service", "stopped", 1005),
    ]);

    expect(result).toEqual({ ok: true, missing: [], unhealthy: [] });
  });

  test("fails when a required worker is missing", () => {
    const result = evaluatePm2Processes([
      row("vidora", "online"),
      row("vidora-generation-worker", "online"),
    ]);

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["vidora-export-worker", "vidora-talking-photo-worker"]);
    expect(result.unhealthy).toEqual([]);
  });

  test("fails when any required process is not online", () => {
    const result = evaluatePm2Processes([
      row("vidora", "online"),
      row("vidora-generation-worker", "errored"),
      row("vidora-export-worker", "launching"),
      row("vidora-talking-photo-worker", "online"),
    ]);

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([]);
    expect(result.unhealthy).toEqual([
      { name: "vidora-generation-worker", status: "errored" },
      { name: "vidora-export-worker", status: "launching" },
    ]);
  });

  test("invalid PM2 output fails closed with all required apps missing", () => {
    const result = evaluatePm2Processes({ unexpected: true });
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([...EXPECTED_VIDORA_PM2_APPS]);
  });

  test("accepts the supervised worker entry scripts registered in PM2", () => {
    const projectDir = "/home/lightworld/webapps/vidora";
    const result = evaluateDurableWorkerTargets([
      row(
        "vidora-generation-worker",
        "online",
        1002,
        `${projectDir}/${EXPECTED_DURABLE_WORKER_TARGETS["vidora-generation-worker"]}`,
      ),
      row(
        "vidora-export-worker",
        "online",
        1003,
        `${projectDir}/${EXPECTED_DURABLE_WORKER_TARGETS["vidora-export-worker"]}`,
      ),
      row(
        "vidora-talking-photo-worker",
        "online",
        1004,
        `${projectDir}/${EXPECTED_DURABLE_WORKER_TARGETS["vidora-talking-photo-worker"]}`,
      ),
    ], projectDir);

    expect(result).toEqual([]);
  });

  test("detects historical direct worker scripts that bypass the supervisor", () => {
    const projectDir = "/home/lightworld/webapps/vidora";
    const result = evaluateDurableWorkerTargets([
      row(
        "vidora-generation-worker",
        "online",
        1002,
        `${projectDir}/scripts/generation-worker.ts`,
      ),
      row(
        "vidora-export-worker",
        "online",
        1003,
        `${projectDir}/scripts/export-worker-entry.ts`,
      ),
    ], projectDir);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "vidora-generation-worker",
      currentPath: `${projectDir}/scripts/generation-worker.ts`,
      expectedPath: `${projectDir}/scripts/generation-worker-entry.ts`,
      status: `script-target-mismatch:${projectDir}/scripts/generation-worker.ts`,
    });
  });

  test("treats a missing PM2 executable path as a stale worker definition", () => {
    const projectDir = "/home/lightworld/webapps/vidora";
    const result = evaluateDurableWorkerTargets([
      row("vidora-generation-worker", "online", 1002),
      row(
        "vidora-export-worker",
        "online",
        1003,
        `${projectDir}/scripts/export-worker-entry.ts`,
      ),
    ], projectDir);

    expect(result).toEqual([{
      name: "vidora-generation-worker",
      currentPath: null,
      expectedPath: `${projectDir}/scripts/generation-worker-entry.ts`,
      status: "script-target-missing",
    }]);
  });

  test("accepts a fresh database heartbeat from the current PM2 worker PID", () => {
    const now = 1_000_000;
    const result = evaluateWorkerHeartbeat(
      heartbeat("vidora-generation-worker", 4242, now - 5_000),
      "vidora-generation-worker",
      4242,
      now,
      30_000,
    );
    expect(result).toEqual({ ok: true, status: "ready" });
  });

  test("rejects a missing or stale worker database heartbeat", () => {
    const now = 1_000_000;
    expect(evaluateWorkerHeartbeat(
      null,
      "vidora-export-worker",
      5151,
      now,
      30_000,
    )).toEqual({ ok: false, status: "heartbeat-missing" });

    expect(evaluateWorkerHeartbeat(
      heartbeat("vidora-export-worker", 5151, now - 30_001),
      "vidora-export-worker",
      5151,
      now,
      30_000,
    )).toEqual({ ok: false, status: "heartbeat-stale" });
  });

  test("rejects a heartbeat left behind by the previous PM2 worker PID", () => {
    const now = 1_000_000;
    expect(evaluateWorkerHeartbeat(
      heartbeat("vidora-generation-worker", 1111, now - 1_000),
      "vidora-generation-worker",
      2222,
      now,
      30_000,
    )).toEqual({ ok: false, status: "heartbeat-pid-mismatch:1111" });
  });

  test("rejects unknown PM2 pids and impossible future heartbeat timestamps", () => {
    const now = 1_000_000;
    expect(evaluateWorkerHeartbeat(
      heartbeat("vidora-export-worker", 5151, now),
      "vidora-export-worker",
      null,
      now,
      30_000,
    )).toEqual({ ok: false, status: "heartbeat-pid-unknown" });

    expect(evaluateWorkerHeartbeat(
      heartbeat("vidora-export-worker", 5151, now + 5_001),
      "vidora-export-worker",
      5151,
      now,
      30_000,
    )).toEqual({ ok: false, status: "heartbeat-clock-skew" });
  });
});
