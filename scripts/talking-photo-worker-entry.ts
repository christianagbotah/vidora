import { superviseWorker } from "./worker-supervisor";

async function main(): Promise<void> {
  try {
    await superviseWorker(
      "vidora-talking-photo-worker",
      () => import("./talking-photo-worker"),
    );
  } catch (error) {
    console.error(
      "[talking-photo-worker-entry] fatal readiness failure:",
      error instanceof Error ? error.message : "unknown error",
    );
    process.exit(1);
  }
}

void main();
