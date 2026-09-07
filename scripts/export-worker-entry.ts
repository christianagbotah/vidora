import { superviseWorker } from "./worker-supervisor";

async function main(): Promise<void> {
  try {
    await superviseWorker(
      "vidora-export-worker",
      () => import("./export-worker"),
    );
  } catch (error) {
    console.error(
      "[export-worker-entry] fatal readiness failure:",
      error instanceof Error ? error.message : "unknown error",
    );
    process.exit(1);
  }
}

void main();
