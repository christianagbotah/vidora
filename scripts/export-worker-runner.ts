import { db } from "@/lib/db";
import { runExportJob } from "@/app/api/export-video/route";

const IDLE_MS = Math.max(1_000, Number(process.env.EXPORT_WORKER_IDLE_MS || 3_000));
const STALE_MINUTES = Math.max(1, Number(process.env.EXPORT_WORKER_STALE_MINUTES || 3));
let stopping = false;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function claimJob(): Promise<string | null> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT "id", "status"
      FROM "ExportJob"
      WHERE "activeKey" IS NOT NULL
        AND (
          "status" = 'queued'
          OR (
            "status" = 'running'
            AND "updatedAt" < NOW() - (${STALE_MINUTES} * INTERVAL '1 minute')
          )
        )
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;

    const row = rows[0];
    if (!row) return null;

    await tx.exportJob.update({
      where: { id: row.id },
      data: {
        status: "running",
        step: row.status === "running" ? "Recovering interrupted export…" : "Preparing export…",
        error: null,
        updatedAt: new Date(),
      },
    });

    return row.id;
  });
}

async function runForever(): Promise<void> {
  console.log("[export-worker] started");

  while (!stopping) {
    let jobId: string | null = null;
    try {
      jobId = await claimJob();
      if (!jobId) {
        await sleep(IDLE_MS);
        continue;
      }
      await runExportJob(jobId);
    } catch (error) {
      console.error(
        `[export-worker] ${jobId ? `job=${jobId} ` : ""}error`,
        error instanceof Error ? error.message : "unknown error"
      );
      // runExportJob records normal pipeline failures itself. An uncaught worker
      // failure leaves activeKey intact; after the stale lease expires another
      // worker iteration can safely recover the persisted job.
      await sleep(IDLE_MS);
    }
  }

  await db.$disconnect();
  console.log("[export-worker] stopped");
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

runForever().catch(async (error) => {
  console.error(
    "[export-worker] fatal",
    error instanceof Error ? error.message : "unknown error"
  );
  await db.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
