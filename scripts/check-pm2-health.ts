import { execFile } from "child_process";
import { promisify } from "util";
import {
  type VidoraDurableWorkerName,
  type WorkerHeartbeatRecord,
  VIDORA_DURABLE_WORKERS,
  readWorkerHeartbeat,
} from "./worker-heartbeat";

const execFileAsync = promisify(execFile);

export const EXPECTED_VIDORA_PM2_APPS = [
  "vidora",
  "vidora-generation-worker",
  "vidora-export-worker",
] as const;

interface Pm2ProcessRow {
  name?: unknown;
  pid?: unknown;
  pm2_env?: {
    status?: unknown;
    restart_time?: unknown;
    unstable_restarts?: unknown;
  } | null;
}

export interface Pm2HealthEvaluation {
  ok: boolean;
  missing: string[];
  unhealthy: Array<{ name: string; status: string }>;
}

export interface WorkerHeartbeatEvaluation {
  ok: boolean;
  status: string;
}

export function evaluatePm2Processes(
  raw: unknown,
  expected: readonly string[] = EXPECTED_VIDORA_PM2_APPS,
): Pm2HealthEvaluation {
  const rows = Array.isArray(raw) ? raw as Pm2ProcessRow[] : [];
  const byName = new Map<string, Pm2ProcessRow>();
  for (const row of rows) {
    if (typeof row?.name === "string" && row.name) byName.set(row.name, row);
  }

  const missing: string[] = [];
  const unhealthy: Array<{ name: string; status: string }> = [];
  for (const name of expected) {
    const row = byName.get(name);
    if (!row) {
      missing.push(name);
      continue;
    }
    const status = typeof row.pm2_env?.status === "string"
      ? row.pm2_env.status
      : "unknown";
    if (status !== "online") unhealthy.push({ name, status });
  }

  return { ok: missing.length === 0 && unhealthy.length === 0, missing, unhealthy };
}

export function evaluateWorkerHeartbeat(
  record: WorkerHeartbeatRecord | null,
  worker: VidoraDurableWorkerName,
  expectedPid: number | null,
  nowMs: number,
  maxAgeMs: number,
): WorkerHeartbeatEvaluation {
  if (!expectedPid || expectedPid <= 0) {
    return { ok: false, status: "heartbeat-pid-unknown" };
  }
  if (!record) {
    return { ok: false, status: "heartbeat-missing" };
  }
  if (record.worker !== worker) {
    return { ok: false, status: "heartbeat-worker-mismatch" };
  }
  if (record.pid !== expectedPid) {
    return { ok: false, status: `heartbeat-pid-mismatch:${record.pid}` };
  }
  if (record.checkedAtMs > nowMs + 5_000) {
    return { ok: false, status: "heartbeat-clock-skew" };
  }
  if (nowMs - record.checkedAtMs > maxAgeMs) {
    return { ok: false, status: "heartbeat-stale" };
  }
  return { ok: true, status: "ready" };
}

async function readPm2List(): Promise<unknown> {
  const { stdout } = await execFileAsync("pm2", ["jlist"], {
    timeout: 10_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error("pm2 jlist returned invalid JSON");
  }
}

function heartbeatMaxAgeMs(): number {
  const probeInterval = Math.max(
    2_000,
    Math.min(60_000, Number(process.env.WORKER_DB_PROBE_INTERVAL_MS || 10_000) || 10_000),
  );
  const fallback = Math.max(30_000, probeInterval * 3);
  return Math.max(
    10_000,
    Math.min(300_000, Number(process.env.PM2_WORKER_HEARTBEAT_MAX_AGE_MS || fallback) || fallback),
  );
}

async function evaluateCurrentWorkerHeartbeats(
  raw: unknown,
): Promise<Array<{ name: string; status: string }>> {
  const rows = Array.isArray(raw) ? raw as Pm2ProcessRow[] : [];
  const byName = new Map<string, Pm2ProcessRow>();
  for (const row of rows) {
    if (typeof row?.name === "string" && row.name) byName.set(row.name, row);
  }

  const nowMs = Date.now();
  const maxAgeMs = heartbeatMaxAgeMs();
  const results = await Promise.all(
    VIDORA_DURABLE_WORKERS.map(async (worker) => {
      const row = byName.get(worker);
      const pid = typeof row?.pid === "number" && Number.isInteger(row.pid) ? row.pid : null;
      const heartbeat = await readWorkerHeartbeat(worker);
      return {
        worker,
        evaluation: evaluateWorkerHeartbeat(heartbeat, worker, pid, nowMs, maxAgeMs),
      };
    }),
  );

  return results
    .filter(({ evaluation }) => !evaluation.ok)
    .map(({ worker, evaluation }) => ({ name: worker, status: evaluation.status }));
}

async function printDiagnostics(): Promise<void> {
  try {
    const { stdout, stderr } = await execFileAsync("pm2", ["status"], {
      timeout: 10_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    if (stdout.trim()) console.error(stdout.trim());
    if (stderr.trim()) console.error(stderr.trim());
  } catch (error) {
    console.error(
      "[pm2-health] unable to read pm2 status:",
      error instanceof Error ? error.message : "unknown error",
    );
  }

  for (const name of EXPECTED_VIDORA_PM2_APPS) {
    try {
      const { stdout, stderr } = await execFileAsync(
        "pm2",
        ["logs", name, "--lines", "60", "--nostream"],
        { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 },
      );
      const output = `${stdout}\n${stderr}`.trim();
      if (output) console.error(`\n[pm2-health] ${name} recent logs:\n${output}`);
    } catch (error) {
      console.error(
        `[pm2-health] unable to read logs for ${name}:`,
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }
}

async function main(): Promise<void> {
  const attempts = Math.max(1, Math.min(30, Number(process.env.PM2_HEALTH_ATTEMPTS || 10)) || 10);
  const delayMs = Math.max(250, Math.min(10_000, Number(process.env.PM2_HEALTH_DELAY_MS || 2_000)) || 2_000);
  let last: Pm2HealthEvaluation | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const raw = await readPm2List();
      last = evaluatePm2Processes(raw);
      if (last.ok) {
        const heartbeatIssues = await evaluateCurrentWorkerHeartbeats(raw);
        if (heartbeatIssues.length === 0) {
          console.log(
            `PM2 health: OK (${EXPECTED_VIDORA_PM2_APPS.join(", ")}; durable worker DB heartbeats verified)`,
          );
          return;
        }
        last = { ...last, ok: false, unhealthy: heartbeatIssues };
      }

      const issues = [
        ...(last.missing.length ? [`missing: ${last.missing.join(", ")}`] : []),
        ...(last.unhealthy.length
          ? [`unhealthy: ${last.unhealthy.map((item) => `${item.name}=${item.status}`).join(", ")}`]
          : []),
      ].join("; ");
      console.warn(`[pm2-health] attempt ${attempt}/${attempts}: ${issues || "unknown process state"}`);
    } catch (error) {
      console.warn(
        `[pm2-health] attempt ${attempt}/${attempts} failed to inspect PM2:`,
        error instanceof Error ? error.message : "unknown error",
      );
    }

    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  console.error("FATAL: Vidora web/workers did not become production-ready after restart");
  if (last?.missing.length) console.error(`Missing: ${last.missing.join(", ")}`);
  if (last?.unhealthy.length) {
    console.error(`Unhealthy: ${last.unhealthy.map((item) => `${item.name}=${item.status}`).join(", ")}`);
  }
  await printDiagnostics();
  process.exitCode = 1;
}

if (import.meta.main) void main();
