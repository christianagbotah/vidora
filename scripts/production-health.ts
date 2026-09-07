import { execFile } from "child_process";
import { promisify } from "util";
import { mkdir, rm, statfs, writeFile } from "fs/promises";
import path from "path";
import { db } from "../src/lib/db";
import {
  EXPECTED_VIDORA_PM2_APPS,
  evaluatePm2Processes,
  evaluateWorkerHeartbeat,
} from "./check-pm2-health";
import {
  VIDORA_DURABLE_WORKERS,
  readWorkerHeartbeat,
  type VidoraDurableWorkerName,
} from "./worker-heartbeat";

const execFileAsync = promisify(execFile);
const GIB = 1024 ** 3;

export type HealthSeverity = "warning" | "critical";

export interface OperationalIssue {
  code: string;
  severity: HealthSeverity;
  message: string;
}

export interface ProductionHealthSnapshot {
  databaseOk: boolean;
  pm2Missing: string[];
  pm2Unhealthy: Array<{ name: string; status: string }>;
  heartbeatUnhealthy: Array<{ name: string; status: string }>;
  staleGenerationRuns: number;
  generationReconciliationRuns: number;
  staleExportJobs: number;
  generatedStoreWritable: boolean;
  generatedStoreFreeBytes: number;
  backupStoreWritable: boolean;
  backupStoreFreeBytes: number;
  diskMinFreeBytes: number;
  webStatus: number | null;
  aiStatus: string | null;
}

export interface ProductionHealthReport {
  status: "ok" | "degraded" | "down";
  checkedAt: string;
  issues: OperationalIssue[];
  snapshot: ProductionHealthSnapshot;
}

export function evaluateProductionHealthSnapshot(
  snapshot: ProductionHealthSnapshot,
  checkedAt = new Date().toISOString(),
): ProductionHealthReport {
  const issues: OperationalIssue[] = [];

  if (!snapshot.databaseOk) {
    issues.push({ code: "database_unreachable", severity: "critical", message: "PostgreSQL health probe failed" });
  }
  if (snapshot.pm2Missing.length) {
    issues.push({
      code: "pm2_missing",
      severity: "critical",
      message: `Required PM2 process(es) missing: ${snapshot.pm2Missing.join(", ")}`,
    });
  }
  if (snapshot.pm2Unhealthy.length) {
    issues.push({
      code: "pm2_unhealthy",
      severity: "critical",
      message: `PM2 process(es) unhealthy: ${snapshot.pm2Unhealthy.map((item) => `${item.name}=${item.status}`).join(", ")}`,
    });
  }
  if (snapshot.heartbeatUnhealthy.length) {
    issues.push({
      code: "worker_heartbeat",
      severity: "critical",
      message: `Durable worker DB heartbeat failure: ${snapshot.heartbeatUnhealthy.map((item) => `${item.name}=${item.status}`).join(", ")}`,
    });
  }
  if (snapshot.staleGenerationRuns > 0) {
    issues.push({
      code: "generation_stale",
      severity: "warning",
      message: `${snapshot.staleGenerationRuns} active generation run(s) have stale durable state`,
    });
  }
  if (snapshot.generationReconciliationRuns > 0) {
    issues.push({
      code: "generation_reconciliation",
      severity: "warning",
      message: `${snapshot.generationReconciliationRuns} generation run(s) need reconciliation`,
    });
  }
  if (snapshot.staleExportJobs > 0) {
    issues.push({
      code: "export_stale",
      severity: "warning",
      message: `${snapshot.staleExportJobs} active export job(s) have stale durable state`,
    });
  }
  if (!snapshot.generatedStoreWritable) {
    issues.push({ code: "generated_store_unwritable", severity: "critical", message: "Generated media store is not writable" });
  }
  if (!snapshot.backupStoreWritable) {
    issues.push({ code: "backup_store_unwritable", severity: "critical", message: "Backup store is not writable" });
  }
  if (snapshot.generatedStoreFreeBytes < snapshot.diskMinFreeBytes) {
    issues.push({
      code: "generated_store_low_disk",
      severity: "warning",
      message: `Generated media filesystem has only ${(snapshot.generatedStoreFreeBytes / GIB).toFixed(2)} GiB free`,
    });
  }
  if (snapshot.backupStoreFreeBytes < snapshot.diskMinFreeBytes) {
    issues.push({
      code: "backup_store_low_disk",
      severity: "warning",
      message: `Backup filesystem has only ${(snapshot.backupStoreFreeBytes / GIB).toFixed(2)} GiB free`,
    });
  }
  if (snapshot.webStatus !== 200) {
    issues.push({
      code: "web_unreachable",
      severity: "critical",
      message: `Local Vidora web probe returned ${snapshot.webStatus ?? "no response"}`,
    });
  }
  if (snapshot.aiStatus !== "ok") {
    issues.push({
      code: "ai_not_ready",
      severity: "critical",
      message: `AI readiness is ${snapshot.aiStatus ?? "unavailable"}`,
    });
  }

  const status = issues.some((issue) => issue.severity === "critical")
    ? "down"
    : issues.length
      ? "degraded"
      : "ok";
  return { status, checkedAt, issues, snapshot };
}

function boundedNumber(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function heartbeatMaxAgeMs(): number {
  const probeInterval = boundedNumber(process.env.WORKER_DB_PROBE_INTERVAL_MS, 10_000, 2_000, 60_000);
  const fallback = Math.max(30_000, probeInterval * 3);
  return boundedNumber(process.env.PM2_WORKER_HEARTBEAT_MAX_AGE_MS, fallback, 10_000, 300_000);
}

async function readPm2List(): Promise<unknown> {
  const { stdout } = await execFileAsync("pm2", ["jlist"], {
    timeout: 10_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function workerHeartbeatIssues(raw: unknown): Promise<Array<{ name: string; status: string }>> {
  const rows = Array.isArray(raw) ? raw as Array<{ name?: unknown; pid?: unknown }> : [];
  const byName = new Map(rows.filter((row) => typeof row.name === "string").map((row) => [String(row.name), row]));
  const nowMs = Date.now();
  const maxAgeMs = heartbeatMaxAgeMs();
  const results = await Promise.all(VIDORA_DURABLE_WORKERS.map(async (worker: VidoraDurableWorkerName) => {
    const row = byName.get(worker);
    const pid = typeof row?.pid === "number" && Number.isInteger(row.pid) ? row.pid : null;
    const record = await readWorkerHeartbeat(worker);
    return { name: worker, evaluation: evaluateWorkerHeartbeat(record, worker, pid, nowMs, maxAgeMs) };
  }));
  return results.filter((item) => !item.evaluation.ok).map((item) => ({ name: item.name, status: item.evaluation.status }));
}

async function probeWritableDirectory(dir: string): Promise<{ writable: boolean; freeBytes: number }> {
  try {
    await mkdir(dir, { recursive: true });
    const fs = await statfs(dir);
    const freeBytes = Number(fs.bavail) * Number(fs.bsize);
    const marker = path.join(dir, `.vidora-health-${process.pid}-${Date.now()}`);
    await writeFile(marker, "ok\n", { encoding: "utf8", mode: 0o600 });
    await rm(marker, { force: true });
    return { writable: true, freeBytes };
  } catch {
    return { writable: false, freeBytes: 0 };
  }
}

async function fetchStatus(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
    return response.status;
  } catch {
    return null;
  }
}

async function fetchAiStatus(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json() as { status?: unknown };
    return typeof payload.status === "string" ? payload.status : null;
  } catch {
    return null;
  }
}

export async function collectProductionHealthSnapshot(now = new Date()): Promise<ProductionHealthSnapshot> {
  const generatedDir = process.env.GENERATED_DIR || path.join(process.cwd(), "generated-store");
  const backupDir = process.env.BACKUP_DIR || path.join(process.cwd(), "backups");
  const localBaseUrl = (process.env.OPS_LOCAL_BASE_URL || "http://127.0.0.1:3004").replace(/\/$/, "");
  const diskMinFreeGb = boundedNumber(process.env.OPS_DISK_MIN_FREE_GB, 2, 0, 10_000);
  const generationStaleMinutes = boundedNumber(process.env.OPS_GENERATION_STALE_MINUTES, 15, 1, 1_440);
  const exportStaleMinutes = boundedNumber(process.env.OPS_EXPORT_STALE_MINUTES, 5, 1, 1_440);

  let databaseOk = true;
  let staleGenerationRuns = 0;
  let generationReconciliationRuns = 0;
  let staleExportJobs = 0;
  try {
    await db.$queryRaw`SELECT 1`;
    const generationCutoff = new Date(now.getTime() - generationStaleMinutes * 60_000);
    const exportCutoff = new Date(now.getTime() - exportStaleMinutes * 60_000);
    [staleGenerationRuns, generationReconciliationRuns, staleExportJobs] = await Promise.all([
      db.generationRun.count({
        where: {
          activeKey: { not: null },
          status: { in: ["running", "processing", "waiting_provider"] },
          updatedAt: { lt: generationCutoff },
        },
      }),
      db.generationRun.count({ where: { status: "needs_reconciliation" } }),
      db.exportJob.count({
        where: {
          activeKey: { not: null },
          status: { in: ["queued", "running"] },
          updatedAt: { lt: exportCutoff },
        },
      }),
    ]);
  } catch {
    databaseOk = false;
  }

  let pm2Missing = [...EXPECTED_VIDORA_PM2_APPS];
  let pm2Unhealthy: Array<{ name: string; status: string }> = [];
  let heartbeatUnhealthy: Array<{ name: string; status: string }> = [];
  try {
    const raw = await readPm2List();
    const pm2 = evaluatePm2Processes(raw);
    pm2Missing = pm2.missing;
    pm2Unhealthy = pm2.unhealthy;
    heartbeatUnhealthy = await workerHeartbeatIssues(raw);
  } catch (error) {
    pm2Missing = [];
    pm2Unhealthy = [{ name: "pm2", status: error instanceof Error ? error.message : "inspection-failed" }];
  }

  const [generatedStore, backupStore, webStatus, aiStatus] = await Promise.all([
    probeWritableDirectory(generatedDir),
    probeWritableDirectory(backupDir),
    fetchStatus(`${localBaseUrl}/`),
    fetchAiStatus(`${localBaseUrl}/api/ai/health`),
  ]);

  return {
    databaseOk,
    pm2Missing,
    pm2Unhealthy,
    heartbeatUnhealthy,
    staleGenerationRuns,
    generationReconciliationRuns,
    staleExportJobs,
    generatedStoreWritable: generatedStore.writable,
    generatedStoreFreeBytes: generatedStore.freeBytes,
    backupStoreWritable: backupStore.writable,
    backupStoreFreeBytes: backupStore.freeBytes,
    diskMinFreeBytes: Math.ceil(diskMinFreeGb * GIB),
    webStatus,
    aiStatus,
  };
}

export async function runProductionHealthChecks(): Promise<ProductionHealthReport> {
  const now = new Date();
  const snapshot = await collectProductionHealthSnapshot(now);
  return evaluateProductionHealthSnapshot(snapshot, now.toISOString());
}

async function main(): Promise<void> {
  try {
    const report = await runProductionHealthChecks();
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== "ok") process.exitCode = 1;
  } finally {
    await db.$disconnect().catch(() => undefined);
  }
}

if (import.meta.main) {
  main().catch(async (error) => {
    console.error(error instanceof Error ? error.message : "production health check failed");
    await db.$disconnect().catch(() => undefined);
    process.exitCode = 1;
  });
}
