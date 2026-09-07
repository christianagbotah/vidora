import { describe, expect, test } from "bun:test";
import {
  evaluateProductionHealthSnapshot,
  type ProductionHealthSnapshot,
} from "../../scripts/production-health";

function healthySnapshot(): ProductionHealthSnapshot {
  return {
    databaseOk: true,
    pm2Missing: [],
    pm2Unhealthy: [],
    heartbeatUnhealthy: [],
    staleGenerationRuns: 0,
    generationReconciliationRuns: 0,
    staleExportJobs: 0,
    generatedStoreWritable: true,
    generatedStoreFreeBytes: 20 * 1024 ** 3,
    backupStoreWritable: true,
    backupStoreFreeBytes: 20 * 1024 ** 3,
    diskMinFreeBytes: 2 * 1024 ** 3,
    webStatus: 200,
    aiStatus: "ok",
  };
}

describe("Vidora production health evaluation", () => {
  test("reports ok when platform and durable state are healthy", () => {
    const report = evaluateProductionHealthSnapshot(healthySnapshot(), "2026-09-07T00:00:00.000Z");
    expect(report.status).toBe("ok");
    expect(report.issues).toEqual([]);
  });

  test("treats reconciliation and stale durable work as degraded warnings", () => {
    const snapshot = healthySnapshot();
    snapshot.staleGenerationRuns = 2;
    snapshot.generationReconciliationRuns = 1;
    snapshot.staleExportJobs = 3;
    const report = evaluateProductionHealthSnapshot(snapshot);
    expect(report.status).toBe("degraded");
    expect(report.issues.map((issue) => issue.code).sort()).toEqual([
      "export_stale",
      "generation_reconciliation",
      "generation_stale",
    ]);
    expect(report.issues.every((issue) => issue.severity === "warning")).toBe(true);
  });

  test("treats current worker heartbeat failure as platform down", () => {
    const snapshot = healthySnapshot();
    snapshot.heartbeatUnhealthy = [{ name: "vidora-export-worker", status: "heartbeat-stale" }];
    const report = evaluateProductionHealthSnapshot(snapshot);
    expect(report.status).toBe("down");
    expect(report.issues).toContainEqual(expect.objectContaining({ code: "worker_heartbeat", severity: "critical" }));
  });

  test("treats low disk as degraded but unwritable storage as down", () => {
    const lowDisk = healthySnapshot();
    lowDisk.backupStoreFreeBytes = 1;
    expect(evaluateProductionHealthSnapshot(lowDisk).status).toBe("degraded");

    const unwritable = healthySnapshot();
    unwritable.generatedStoreWritable = false;
    expect(evaluateProductionHealthSnapshot(unwritable).status).toBe("down");
  });

  test("database, web, PM2 and AI readiness failures are critical", () => {
    const snapshot = healthySnapshot();
    snapshot.databaseOk = false;
    snapshot.pm2Missing = ["vidora-generation-worker"];
    snapshot.webStatus = null;
    snapshot.aiStatus = "degraded";
    const report = evaluateProductionHealthSnapshot(snapshot);
    expect(report.status).toBe("down");
    expect(report.issues.filter((issue) => issue.severity === "critical").map((issue) => issue.code).sort()).toEqual([
      "ai_not_ready",
      "database_unreachable",
      "pm2_missing",
      "web_unreachable",
    ]);
  });
});
