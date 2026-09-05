import { describe, expect, test } from "bun:test";
import { withRetry, ZAIError } from "@/lib/zai";

describe("Z.ai retry backoff", () => {
  test("a real AbortController timeout still reaches later retry attempts", async () => {
    const originalRandom = Math.random;
    Math.random = () => 0;
    let attempts = 0;

    try {
      const result = await withRetry(
        async (signal) => {
          attempts += 1;
          if (attempts === 3) return "recovered";

          return new Promise<string>((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => reject(new ZAIError(`attempt ${attempts} timed out`, "timeout")),
              { once: true },
            );
          });
        },
        {
          maxRetries: 3,
          timeoutMs: 5,
          baseDelayMs: 0,
          maxDelayMs: 0,
          label: "timeout retry regression",
        },
      );

      expect(result).toBe("recovered");
      expect(attempts).toBe(3);
    } finally {
      Math.random = originalRandom;
    }
  });

  test("non-retryable provider errors still fail immediately", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw new ZAIError("bad request", "validation");
        },
        { maxRetries: 4, baseDelayMs: 0, maxDelayMs: 0, timeoutMs: 100 },
      ),
    ).rejects.toMatchObject({ kind: "validation" });

    expect(attempts).toBe(1);
  });
});
