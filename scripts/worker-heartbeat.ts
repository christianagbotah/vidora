import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";

export const VIDORA_DURABLE_WORKERS = [
  "vidora-generation-worker",
  "vidora-export-worker",
  "vidora-talking-photo-worker",
] as const;

export type VidoraDurableWorkerName = typeof VIDORA_DURABLE_WORKERS[number];

export interface WorkerHeartbeatRecord {
  worker: VidoraDurableWorkerName;
  pid: number;
  checkedAtMs: number;
}

function heartbeatDirectory(cwd = process.cwd()): string {
  return path.join(cwd, "logs", "worker-heartbeats");
}

export function workerHeartbeatPath(worker: VidoraDurableWorkerName, cwd = process.cwd()): string {
  return path.join(heartbeatDirectory(cwd), `${worker}.json`);
}

export async function writeWorkerHeartbeat(worker: VidoraDurableWorkerName): Promise<void> {
  const directory = heartbeatDirectory();
  const target = workerHeartbeatPath(worker);
  const temporary = `${target}.tmp-${process.pid}`;
  const record: WorkerHeartbeatRecord = {
    worker,
    pid: process.pid,
    checkedAtMs: Date.now(),
  };

  await mkdir(directory, { recursive: true });
  await writeFile(temporary, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o640 });
  await rename(temporary, target);
}

export async function readWorkerHeartbeat(
  worker: VidoraDurableWorkerName,
): Promise<WorkerHeartbeatRecord | null> {
  try {
    const raw = JSON.parse(await readFile(workerHeartbeatPath(worker), "utf8")) as Partial<WorkerHeartbeatRecord>;
    if (
      raw.worker !== worker ||
      typeof raw.pid !== "number" ||
      !Number.isInteger(raw.pid) ||
      raw.pid <= 0 ||
      typeof raw.checkedAtMs !== "number" ||
      !Number.isFinite(raw.checkedAtMs)
    ) {
      return null;
    }
    return raw as WorkerHeartbeatRecord;
  } catch {
    return null;
  }
}
