import { superviseWorker } from "./worker-supervisor";

try {
  await superviseWorker(
    "vidora-generation-worker",
    () => import("./generation-worker"),
  );
} catch (error) {
  console.error(
    "[generation-worker-entry] fatal readiness failure:",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exit(1);
}
