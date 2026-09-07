import { db } from "@/lib/db";
import {
  type VidoraDurableWorkerName,
  writeWorkerHeartbeat,
} from "./worker-heartbeat";

function boundedNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

const PROBE_INTERVAL_MS = boundedNumber(
  process.env.WORKER_DB_PROBE_INTERVAL_MS,
  10_000,
  2_000,
  60_000,
);
const FAILURE_LIMIT = boundedNumber(
  process.env.WORKER_DB_FAILURE_LIMIT,
  3,
  1,
  10,
);

async function verifyDatabase(worker: VidoraDurableWorkerName): Promise<void> {
  await db.$queryRaw`SELECT 1`;
  await writeWorkerHeartbeat(worker);
}

export async function superviseWorker(
  worker: VidoraDurableWorkerName,
  launch: () => Promise<unknown>,
): Promise<void> {
  await verifyDatabase(worker);
  console.log(`[worker-supervisor] ${worker} database readiness: OK`);

  let failures = 0;
  let probeRunning = false;
  let stopped = false;

  const timer = setInterval(() => {
    if (stopped || probeRunning) return;
    probeRunning = true;
    void verifyDatabase(worker)
      .then(() => {
        failures = 0;
      })
      .catch((error) => {
        failures += 1;
        console.error(
          `[worker-supervisor] ${worker} database probe failed (${failures}/${FAILURE_LIMIT}):`,
          error instanceof Error ? error.message : "unknown error",
        );
        if (failures >= FAILURE_LIMIT) {
          stopped = true;
          clearInterval(timer);
          console.error(
            `[worker-supervisor] ${worker} lost database connectivity; exiting so PM2 can restart it`,
          );
          process.exit(1);
        }
      })
      .finally(() => {
        probeRunning = false;
      });
  }, PROBE_INTERVAL_MS);

  const stopProbe = () => {
    stopped = true;
    clearInterval(timer);
  };
  process.once("SIGTERM", stopProbe);
  process.once("SIGINT", stopProbe);

  try {
    await launch();
  } catch (error) {
    stopProbe();
    throw error;
  }
}
