import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export const EXPECTED_VIDORA_PM2_APPS = [
  "vidora",
  "vidora-generation-worker",
  "vidora-export-worker",
] as const;

interface Pm2ProcessRow {
  name?: unknown;
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
      last = evaluatePm2Processes(await readPm2List());
      if (last.ok) {
        console.log(`PM2 health: OK (${EXPECTED_VIDORA_PM2_APPS.join(", ")})`);
        return;
      }

      const issues = [
        ...(last.missing.length ? [`missing: ${last.missing.join(", ")}`] : []),
        ...(last.unhealthy.length
          ? [`not online: ${last.unhealthy.map((item) => `${item.name}=${item.status}`).join(", ")}`]
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

  console.error("FATAL: not all required Vidora PM2 processes became online after restart");
  if (last?.missing.length) console.error(`Missing: ${last.missing.join(", ")}`);
  if (last?.unhealthy.length) {
    console.error(`Unhealthy: ${last.unhealthy.map((item) => `${item.name}=${item.status}`).join(", ")}`);
  }
  await printDiagnostics();
  process.exitCode = 1;
}

if (import.meta.main) void main();
