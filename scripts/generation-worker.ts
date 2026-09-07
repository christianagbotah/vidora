import { superviseWorker } from "./worker-supervisor";

try {
  await superviseWorker(
    "vidora-generation-worker",
    () => import("./generation-worker-runner"),
  );
} catch (error) {
  console.error(
    "[generation-worker] fatal readiness failure:",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exit(1);
}
