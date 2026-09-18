import { getAIProviderSettings } from "@/lib/ai-provider-router";
import { BillingSafetyError } from "@/lib/provider-cost-billing";
import { getConfigValue } from "@/lib/secure-config";

export const XAI_GLOBAL_BASE_URL = "https://api.x.ai/v1";
export const XAI_BILLABLE_TEXT_MODEL = "grok-4.6";

export interface XaiBilledTextResult {
  content: string;
  usage: { inputTokens: number; outputTokens: number } | null;
  model: string;
  actualCostUsd?: number | null;
}

function normalizedBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function finiteUsage(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.ceil(parsed) : null;
}

export async function assertBillableXaiRoute(model: string): Promise<void> {
  const settings = await getAIProviderSettings();
  if (normalizedBaseUrl(settings.xaiBaseUrl) !== XAI_GLOBAL_BASE_URL) {
    throw new BillingSafetyError(
      "UNPRICED_XAI_ENDPOINT",
      "Paid xAI text is currently priced only for the global https://api.x.ai/v1 endpoint. Configure the global endpoint or verify a separate regional price catalog first.",
    );
  }
  if (model !== XAI_BILLABLE_TEXT_MODEL) {
    throw new BillingSafetyError(
      "UNPRICED_XAI_MODEL",
      `Paid xAI text model ${model} is not in Vidora's verified Billing v2 catalog. Configure grok-4.6 or verify the model price first.`,
    );
  }
}

export async function submitBilledXaiText(opts: {
  model: string;
  systemPrompt?: string | null;
  userPrompt: string;
  maxOutputTokens: number;
  thinking?: "enabled" | "disabled";
  temperature?: number;
  timeoutMs?: number;
}): Promise<XaiBilledTextResult> {
  await assertBillableXaiRoute(opts.model);
  const apiKey = await getConfigValue("xai_api_key", "XAI_API_KEY");
  if (!apiKey) {
    throw new BillingSafetyError(
      "XAI_KEY_MISSING",
      "xAI is selected for paid text but XAI_API_KEY is not configured on the server.",
    );
  }

  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (opts.systemPrompt) messages.push({ role: "system", content: opts.systemPrompt });
  messages.push({ role: "user", content: opts.userPrompt });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 90_000);
  try {
    const response = await fetch(`${XAI_GLOBAL_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        messages,
        temperature: opts.temperature ?? 0.45,
        max_tokens: opts.maxOutputTokens,
        ...(opts.thinking === "enabled" ? { reasoning_effort: "high" } : {}),
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || !body) {
      const nested = body?.error && typeof body.error === "object"
        ? body.error as Record<string, unknown>
        : null;
      const detail = String(nested?.message || body?.message || `HTTP ${response.status}`);
      throw new Error(`Paid xAI text (${opts.model}) failed: ${detail}`);
    }

    const choices = Array.isArray(body.choices) ? body.choices : [];
    const first = choices[0] && typeof choices[0] === "object"
      ? choices[0] as Record<string, unknown>
      : null;
    const message = first?.message && typeof first.message === "object"
      ? first.message as Record<string, unknown>
      : null;
    const content = typeof message?.content === "string" ? message.content.trim() : "";
    if (!content) throw new Error("Paid xAI text returned an empty completion");

    const rawUsage = body.usage && typeof body.usage === "object"
      ? body.usage as Record<string, unknown>
      : null;
    const input = rawUsage
      ? finiteUsage(rawUsage.prompt_tokens ?? rawUsage.input_tokens)
      : null;
    const output = rawUsage
      ? finiteUsage(rawUsage.completion_tokens ?? rawUsage.output_tokens)
      : null;
    const ticks = rawUsage ? Number(rawUsage.cost_in_usd_ticks) : NaN;
    return {
      content,
      usage: input === null || output === null
        ? null
        : { inputTokens: Math.max(1, input), outputTokens: Math.max(1, output) },
      model: opts.model,
      actualCostUsd: Number.isFinite(ticks) && ticks >= 0 ? ticks / 10_000_000_000 : null,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        "Paid xAI text timed out; provider acceptance is ambiguous, so Vidora will not retry or fall back automatically.",
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
