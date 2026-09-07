import type { ProductionHealthReport } from "./production-health";

export interface ProductionMonitorState {
  lastStatus: "ok" | "degraded" | "down" | null;
  lastFingerprint: string;
  lastNotifiedKey: string;
  updatedAt: string;
}

export type MonitorNotification =
  | { kind: "alert"; key: string; fingerprint: string }
  | { kind: "recovery"; key: string; fingerprint: string }
  | null;

export function emptyProductionMonitorState(): ProductionMonitorState {
  return {
    lastStatus: null,
    lastFingerprint: "",
    lastNotifiedKey: "",
    updatedAt: new Date(0).toISOString(),
  };
}

export function productionHealthFingerprint(report: ProductionHealthReport): string {
  if (report.status === "ok") return "ok";
  return report.issues
    .map((issue) => `${issue.severity}:${issue.code}`)
    .sort()
    .join("|");
}

export function decideProductionMonitorNotification(
  previous: ProductionMonitorState,
  report: ProductionHealthReport,
): MonitorNotification {
  const fingerprint = productionHealthFingerprint(report);

  if (report.status === "ok") {
    const hadNotifiedIncident = previous.lastNotifiedKey.startsWith("alert:");
    if (previous.lastStatus && previous.lastStatus !== "ok" && hadNotifiedIncident) {
      const key = `recovery:${previous.lastFingerprint}`;
      if (previous.lastNotifiedKey !== key) return { kind: "recovery", key, fingerprint };
    }
    return null;
  }

  const key = `alert:${fingerprint}`;
  if (previous.lastNotifiedKey === key) return null;
  return { kind: "alert", key, fingerprint };
}

export function nextProductionMonitorState(
  previous: ProductionMonitorState,
  report: ProductionHealthReport,
  notifiedKey?: string | null,
): ProductionMonitorState {
  return {
    lastStatus: report.status,
    lastFingerprint: productionHealthFingerprint(report),
    lastNotifiedKey: notifiedKey ?? previous.lastNotifiedKey,
    updatedAt: report.checkedAt,
  };
}
