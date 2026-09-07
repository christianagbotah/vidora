import { describe, expect, test } from "bun:test";
import {
  EXPECTED_VIDORA_PM2_APPS,
  evaluatePm2Processes,
  evaluateWorkerHeartbeat,
} from "../../scripts/check-pm2-health";
import type { WorkerHeartbeatRecord } from "../../scripts/worker-heartbeat";

function row(name: string, status: string, pid = 1000) {
  return { name, pid, pm2_env: { status, restart_time: 0, unstable_restarts: 0 } };
}

function heartbeat(
  worker: WorkerHeartbeatRecord["worker"],
  pid: number,
  checkedAtMs: number,
): WorkerHeartbeatRecord {
  return { worker, pid, checkedAtMs };
}

describe("Vidora PM2 deployment health", () => {
  test("passes process state only when web and both workers are online", () => {
    const result = evaluatePm2Processes([
      row("vidora", "online", 1001),
      row("vidora-generation-worker", "online", 1002),
      row("vidora-export-worker", "online", 1003),
      row("unrelated-service", "stopped", 1004),
    ]);

    expect(result).toEqual({ ok: true, missing: [], unhealthy: [] });
  });

  test("fails when a required worker is missing", () => {
    const result = evaluatePm2Processes([
      row("vidora", "online"),
      row("vidora-generation-worker", "online"),
    ]);

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["vidora-export-worker"]);
    expect(result.unhealthy).toEqual([]);
  });

  test("fails when any required process is not online", () => {
    const result = evaluatePm2Processes([
      row("vidora", "online"),
      row("vidora-generation-worker", "errored"),
      row("vidora-export-worker", "launching"),
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
