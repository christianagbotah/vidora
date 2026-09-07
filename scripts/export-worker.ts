import { superviseWorker } from "./worker-supervisor";

try {
  await superviseWorker(
    "vidora-export-worker",
    () => import("./export-worker-runner"),
  );
} catch (error) {
  console.error(
    "[export-worker] fatal readiness failure:",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exit(1);
}
