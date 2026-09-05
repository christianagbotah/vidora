import { describe, expect, test } from "bun:test";
import { EXPECTED_VIDORA_PM2_APPS, evaluatePm2Processes } from "../../scripts/check-pm2-health";

function row(name: string, status: string) {
  return { name, pm2_env: { status, restart_time: 0, unstable_restarts: 0 } };
}

describe("Vidora PM2 deployment health", () => {
  test("passes only when web and both workers are online", () => {
    const result = evaluatePm2Processes([
      row("vidora", "online"),
      row("vidora-generation-worker", "online"),
      row("vidora-export-worker", "online"),
      row("unrelated-service", "stopped"),
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
});
