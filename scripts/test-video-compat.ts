/**
 * Vidora — video endpoint compat test
 *
 * Exercises the fixed generateVideo() + pollVideoTask() against whatever
 * credentials resolve locally (in the dev sandbox: the internal gateway via
 * /etc/.z-ai-config; on a VPS: DB/env public API credentials).
 *
 *   bun run scripts/test-video-compat.ts
 */
import { generateVideo, pollVideoTask } from "../src/lib/zai";

async function main() {
  console.log("[test] creating video task...");
  const taskId = await generateVideo({
    prompt:
      "A calm ocean wave rolling onto a quiet sandy beach at dawn, soft golden light, gentle motion, cinematic",
    size: "1920x1080",
    duration: 5,
    quality: "speed",
    withAudio: false,
    retry: { maxRetries: 1, timeoutMs: 60_000 },
  });
  console.log("[test] task created:", taskId);

  const result = await pollVideoTask({
    taskId,
    maxAttempts: 60,
    intervalMs: 10_000,
  });
  console.log(
    "[test] result:",
    JSON.stringify(
      { status: result.status, videoUrl: result.videoUrl, error: result.error },
      null,
      2
    )
  );
  if (result.status !== "success") process.exit(1);
}

main().catch((e) => {
  console.error("[test] FAILED:", e);
  process.exit(1);
});
