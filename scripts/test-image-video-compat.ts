/**
 * Vidora — image + video compat test (constraint normalization)
 *
 * Verifies against the locally-resolved credentials (sandbox: internal
 * gateway; VPS: public api.z.ai):
 *   1. generateImage() works through createImageCompat (public form with
 *      model first, no-model internal form fallback) and returns base64.
 *   2. generateVideo() with an ARBITRARY duration (37s) succeeds — the
 *      compat layer must clamp it to the supported 5/10s enum.
 *   3. The created task polls (single attempt — just proves it's real).
 *
 *   bun run scripts/test-image-video-compat.ts
 */
import { generateImage, generateVideo, pollVideoTask } from "../src/lib/zai";

async function main() {
  console.log("[test] 1) generateImage through createImageCompat...");
  const b64 = await generateImage({
    prompt: "A red umbrella on a rainy city street at dusk, cinematic lighting",
    size: "1344x768",
    retry: { maxRetries: 1, timeoutMs: 120_000 },
  });
  console.log("[test] image OK — base64 length:", b64.length);

  console.log("[test] 2) generateVideo with arbitrary duration=37 (expect clamp to 10)...");
  const taskId = await generateVideo({
    prompt: "A calm ocean wave rolling onto a quiet sandy beach at dawn, soft golden light, gentle motion, cinematic",
    size: "1920x1080",
    duration: 37,
    quality: "speed",
    withAudio: false,
    retry: { maxRetries: 1, timeoutMs: 60_000 },
  });
  console.log("[test] video task created:", taskId);

  console.log("[test] 3) single poll to confirm the task exists...");
  const r = await pollVideoTask({ taskId, maxAttempts: 1, intervalMs: 5_000 });
  console.log("[test] poll status:", r.status, r.error ? `(${r.error})` : "");
  console.log("[test] ALL PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error("[test] FAILED:", e);
  process.exit(1);
});
