import { superviseWorker } from "./worker-supervisor";

async function main(): Promise<void> {
  try {
    await superviseWorker(
      "vidora-talking-photo-speech-worker",
      () => import("./talking-photo-speech-worker"),
    );
  } catch (error) {
    console.error(
      "[talking-photo-speech-worker-entry] fatal readiness failure:",
      error instanceof Error ? error.message : "unknown error",
    );
    process.exit(1);
  }
}

void main();
