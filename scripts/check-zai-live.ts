import { zai, ZAIError } from "../src/lib/zai";

/**
 * Production deployment preflight for the configured Z.ai credential.
 *
 * The public /api/ai/health endpoint intentionally performs a zero-cost
 * configuration check only. Deployment needs a stronger guarantee: the
 * credential must authenticate against the live provider before the running
 * production release is touched. This uses the same free-model probe as the
 * admin-only deep health endpoint and never prints credentials.
 */
async function main(): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    console.warn("[zai-preflight] NODE_ENV is not production; probing configured provider anyway");
  }

  if (!process.env.ZAI_BASE_URL?.trim() || !process.env.ZAI_API_KEY?.trim()) {
    console.error("FATAL: ZAI_BASE_URL and ZAI_API_KEY must be configured for the live provider probe");
    process.exitCode = 1;
    return;
  }

  try {
    await zai.chat({
      model: "glm-4.5-flash",
      systemPrompt: "You are a deployment health check. Reply with exactly: OK",
      userPrompt: "ping",
      thinking: "disabled",
      retry: {
        label: "Production Z.ai deployment preflight",
        maxRetries: 1,
        timeoutMs: 15_000,
      },
    });

    console.log("Z.ai live provider preflight: OK");
  } catch (error) {
    if (error instanceof ZAIError) {
      console.error(`FATAL: Z.ai live provider preflight failed (${error.kind}): ${error.message}`);
    } else {
      console.error(
        "FATAL: Z.ai live provider preflight failed:",
        error instanceof Error ? error.message : "unknown error"
      );
    }
    process.exitCode = 1;
  }
}

void main();
