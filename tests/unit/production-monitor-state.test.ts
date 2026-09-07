import { describe, expect, test } from "bun:test";
import type { ProductionHealthReport } from "../../scripts/production-health";
import {
  decideProductionMonitorNotification,
  emptyProductionMonitorState,
  nextProductionMonitorState,
} from "../../scripts/production-monitor-state";

function report(status: "ok" | "degraded" | "down", codes: string[] = []): ProductionHealthReport {
  return {
    status,
    checkedAt: "2026-09-07T00:00:00.000Z",
    issues: codes.map((code) => ({
      code,
      severity: status === "down" ? "critical" as const : "warning" as const,
      message: code,
    })),
    snapshot: {
      databaseOk: true,
      pm2Missing: [],
      pm2Unhealthy: [],
      heartbeatUnhealthy: [],
      staleGenerationRuns: 0,
      generationReconciliationRuns: 0,
      staleExportJobs: 0,
      generatedStoreWritable: true,
      generatedStoreFreeBytes: 10,
      backupStoreWritable: true,
      backupStoreFreeBytes: 10,
      diskMinFreeBytes: 1,
      webStatus: 200,
      aiStatus: "ok",
    },
  };
}

describe("Vidora production monitor transitions", () => {
  test("does not notify on an initial healthy check", () => {
    expect(decideProductionMonitorNotification(emptyProductionMonitorState(), report("ok"))).toBeNull();
  });

  test("notifies once for a new incident signature", () => {
    const initial = emptyProductionMonitorState();
    const unhealthy = report("down", ["database_unreachable"]);
    const first = decideProductionMonitorNotification(initial, unhealthy);
    expect(first?.kind).toBe("alert");
    const notified = nextProductionMonitorState(initial, unhealthy, first?.key);
    expect(decideProductionMonitorNotification(notified, unhealthy)).toBeNull();
  });

  test("notifies again when the incident signature changes", () => {
    const initial = emptyProductionMonitorState();
    const firstReport = report("degraded", ["backup_store_low_disk"]);
    const first = decideProductionMonitorNotification(initial, firstReport)!;
    const state = nextProductionMonitorState(initial, firstReport, first.key);
    const escalated = report("down", ["backup_store_low_disk", "web_unreachable"]);
    expect(decideProductionMonitorNotification(state, escalated)?.kind).toBe("alert");
  });

  test("sends one recovery only after an incident was actually notified", () => {
    const initial = emptyProductionMonitorState();
    const unhealthy = report("down", ["worker_heartbeat"]);
    const alert = decideProductionMonitorNotification(initial, unhealthy)!;
    const notified = nextProductionMonitorState(initial, unhealthy, alert.key);
    const recovery = decideProductionMonitorNotification(notified, report("ok"));
    expect(recovery?.kind).toBe("recovery");
    const recovered = nextProductionMonitorState(notified, report("ok"), recovery?.key);
    expect(decideProductionMonitorNotification(recovered, report("ok"))).toBeNull();
  });

  test("does not send recovery for an incident that could not be emailed", () => {
    const initial = emptyProductionMonitorState();
    const unhealthy = report("degraded", ["generation_reconciliation"]);
    const unnotifiedState = nextProductionMonitorState(initial, unhealthy, null);
    expect(decideProductionMonitorNotification(unnotifiedState, report("ok"))).toBeNull();
  });
});
