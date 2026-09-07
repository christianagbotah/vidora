import { mkdir, readFile, rename, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { db } from "../src/lib/db";
import { sendPlainTextEmail } from "../src/lib/email";
import { runProductionHealthChecks, type ProductionHealthReport } from "./production-health";
import {
  decideProductionMonitorNotification,
  emptyProductionMonitorState,
  nextProductionMonitorState,
  type ProductionMonitorState,
} from "./production-monitor-state";

function stateFilePath(): string {
  return process.env.OPS_MONITOR_STATE_FILE || path.join(process.cwd(), "logs", "production-monitor-state.json");
}

async function readState(filePath: string): Promise<ProductionMonitorState> {
  try {
    const raw = JSON.parse(await readFile(filePath, "utf8")) as Partial<ProductionMonitorState>;
    const status = raw.lastStatus;
    if (status !== null && status !== "ok" && status !== "degraded" && status !== "down") {
      return emptyProductionMonitorState();
    }
    return {
      lastStatus: status ?? null,
      lastFingerprint: typeof raw.lastFingerprint === "string" ? raw.lastFingerprint : "",
      lastNotifiedKey: typeof raw.lastNotifiedKey === "string" ? raw.lastNotifiedKey : "",
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return emptyProductionMonitorState();
  }
}

async function writeState(filePath: string, state: ProductionMonitorState): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, filePath);
}

function reportSummary(report: ProductionHealthReport): string {
  if (report.status === "ok") return "All production health checks passed.";
  return report.issues
    .map((issue) => `- [${issue.severity.toUpperCase()}] ${issue.code}: ${issue.message}`)
    .join("\n");
}

function alertBody(report: ProductionHealthReport, kind: "alert" | "recovery"): string {
  const host = process.env.HOSTNAME || os.hostname();
  if (kind === "recovery") {
    return [
      "Vidora production health has recovered.",
      "",
      `Host: ${host}`,
      `Checked at: ${report.checkedAt}`,
      "",
      reportSummary(report),
    ].join("\n");
  }
  return [
    `Vidora production health is ${report.status.toUpperCase()}.`,
    "",
    `Host: ${host}`,
    `Checked at: ${report.checkedAt}`,
    "",
    reportSummary(report),
    "",
    "Inspect PM2 logs, durable worker heartbeats, PostgreSQL, queue state, storage capacity, and local web/AI readiness on the Vidora host.",
  ].join("\n");
}

async function main(): Promise<void> {
  const filePath = stateFilePath();
  const previous = await readState(filePath);
  const report = await runProductionHealthChecks();
  const decision = decideProductionMonitorNotification(previous, report);
  const alertEmail = (process.env.OPS_ALERT_EMAIL || "").trim();
  let notifiedKey: string | null = null;
  let notificationFailed = false;

  console.log(`[production-monitor] status=${report.status} checkedAt=${report.checkedAt}`);
  if (report.issues.length) console.log(reportSummary(report));

  if (decision && alertEmail) {
    try {
      const subject = decision.kind === "recovery"
        ? "[Vidora] Production health recovered"
        : `[Vidora] Production ${report.status.toUpperCase()}`;
      await sendPlainTextEmail({
        to: alertEmail,
        subject,
        body: alertBody(report, decision.kind),
      });
      notifiedKey = decision.key;
      console.log(`[production-monitor] ${decision.kind} email sent to ${alertEmail}`);
    } catch (error) {
      notificationFailed = true;
      console.error(
        "[production-monitor] alert email failed; notification state will stay unchanged so the next monitor run retries:",
        error instanceof Error ? error.message : "unknown error",
      );
    }
  } else if (decision && !alertEmail) {
    console.warn("[production-monitor] OPS_ALERT_EMAIL is not configured; health transition was not emailed");
  }

  const next = notificationFailed
    ? previous
    : nextProductionMonitorState(previous, report, notifiedKey);
  await writeState(filePath, next);
  if (report.status !== "ok") process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[production-monitor] fatal", error instanceof Error ? error.message : "unknown error");
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect().catch(() => undefined);
  });
