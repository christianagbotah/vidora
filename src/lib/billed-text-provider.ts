import { getConfigValue } from "@/lib/secure-config";
import { getAIProviderSettings } from "@/lib/ai-provider-router";
import {
  submitBilledZaiText,
  type BilledTextResult,
} from "@/lib/zai-billed-client";
import type { BillableTextProvider } from "@/lib/zai-metered-billing";

export class BilledTextProviderError extends Error {
  constructor(
    public readonly provider: BillableTextProvider,
    message: string,
    public readonly status?: number,
    public readonly ambiguous = false,
  ) {
    super(message);
    this.name = "BilledTextProviderError";
  }
}

function finiteUsage(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.ceil(parsed) : null;
}

function xaiUsage(body: Record<string, unknown>): BilledTextResult["usage"] {
  const raw = body.usage && typeof body.usage === "object"
    ? body.usage as Record<string, unknown>
    : null;
  if (!raw) return null;
  const input = finiteUsage(raw.input_tokens);
  // xAI Responses API output_tokens is the generated-token total. Its
  // output_tokens_details.reasoning_tokens is a subset, so do not add it again.
  const output = finiteUsage(raw.output_tokens);
  if (input === null || output === null) return null;
  return {
    inputTokens: Math.max(1, input),
    outputTokens: Math.max(1, output),
  };
}

function completionContent(body: Record<string, unknown>): string {
  const output = Array.isArray(body.output) ? body.output : [];
  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (record.type !== "message" || !Array.isArray(record.content)) continue;
    for (const content of record.content) {
      if (!content || typeof content !== "object") continue;
      const chunk = content as Record<string, unknown>;
      if (chunk.type === "output_text" && typeof chunk.text === "string" && chunk.text.trim()) {
        parts.push(chunk.text.trim());
      }
    }
  }
  const content = parts.join("\n").trim();
  if (!content) {
    throw new BilledTextProviderError("xai", "Paid xAI text returned an empty response");
  }
  return content;
}

function xaiErrorMessage(body: unknown, status: number): string {
  const obj = body && typeof body === "object" ? body as Record<string, unknown> : null;
  const nested = obj?.error && typeof obj.error === "object"
    ? obj.error as Record<string, unknown>
    : null;
  return String(nested?.message || obj?.message || obj?.error || `HTTP ${status}`);
}

async function submitBilledXaiText(opts: {
  model: string;
  systemPrompt?: string | null;
  userPrompt: string;
  maxOutputTokens: number;
  thinking?: "enabled" | "disabled";
  temperature?: number;
  timeoutMs?: number;
}): Promise<BilledTextResult> {
  const [settings, apiKey] = await Promise.all([
    getAIProviderSettings(),
    getConfigValue("xai_api_key", "XAI_API_KEY"),
  ]);
  if (!apiKey) {
    throw new BilledTextProviderError(
      "xai",
      "xAI API key is not configured for paid text work",
      undefined,
      false,
    );
  }

  const normalizedBase = settings.xaiBaseUrl.replace(/\/+$/, "");
  if (normalizedBase !== "https://api.x.ai/v1") {
    throw new BilledTextProviderError(
      "xai",
      "Billing v2 Grok 4.6 pricing is verified only for the global https://api.x.ai/v1 endpoint",
      undefined,
      false,
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 90_000);
  try {
    const response = await fetch(`${normalizedBase}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        input: opts.userPrompt,
        ...(opts.systemPrompt ? { instructions: opts.systemPrompt } : {}),
        max_output_tokens: opts.maxOutputTokens,
        reasoning: {
          // Grok 4.6 cannot disable reasoning. "low" is the closest bounded
          // execution mode when callers do not request deep reasoning.
          effort: opts.thinking === "enabled" ? "high" : "low",
        },
        store: false,
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    const raw = await response.text();
    let body: unknown = raw;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        if (!response.ok) {
          throw new BilledTextProviderError(
            "xai",
            `Paid xAI text failed with HTTP ${response.status}`,
            response.status,
            false,
          );
        }
        throw new BilledTextProviderError("xai", "Paid xAI text returned a non-JSON response");
      }
    }

    if (!response.ok) {
      const ambiguous = response.status === 408
        || response.status === 429
        || response.status >= 500;
      throw new BilledTextProviderError(
        "xai",
        `Paid xAI text failed: ${xaiErrorMessage(body, response.status)}`,
        response.status,
        ambiguous,
      );
    }
    if (!body || typeof body !== "object") {
      throw new BilledTextProviderError("xai", "Paid xAI text returned an invalid response");
    }

    const objectBody = body as Record<string, unknown>;
    return {
      content: completionContent(objectBody),
      usage: xaiUsage(objectBody),
      model: opts.model,
    };
  } catch (error) {
    if (error instanceof BilledTextProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new BilledTextProviderError(
        "xai",
        "Paid xAI text timed out; provider acceptance is ambiguous and the reservation must remain held",
        undefined,
        true,
      );
    }
    throw new BilledTextProviderError(
      "xai",
      `Paid xAI text transport failed; provider acceptance is ambiguous: ${
        error instanceof Error ? error.message : "unknown network error"
      }`,
      undefined,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function submitBilledText(opts: {
  provider: BillableTextProvider;
  model: string;
  systemPrompt?: string | null;
  userPrompt: string;
  maxOutputTokens: number;
  thinking?: "enabled" | "disabled";
  temperature?: number;
  timeoutMs?: number;
}): Promise<BilledTextResult> {
  if (opts.provider === "zai") {
    return submitBilledZaiText(opts);
  }
  return submitBilledXaiText(opts);
}
