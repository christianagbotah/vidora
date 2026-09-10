import { getClient, ZAIError, classifyError } from "@/lib/zai";
import { resolveZaiAsrBillingModel } from "@/lib/zai-billing-models";

interface ZaiResolvedConfig {
  baseUrl?: string;
  apiKey?: string;
}

/**
 * Use Z.ai's public transcription contract so Billing v2 can prove that the
 * priced ASR model is the exact model submitted to the provider. The legacy
 * SDK helper omits the model field and is therefore not suitable for a paid,
 * model-specific billing boundary.
 */
export async function transcribeWithPricedZaiAsr(opts: {
  file: File;
  timeoutMs?: number;
}): Promise<{ text: string; model: string }> {
  const client = await getClient();
  const config = (client as unknown as { config?: ZaiResolvedConfig }).config;
  if (!config?.baseUrl || !config.apiKey) {
    throw new ZAIError("ZAI client is missing baseUrl/apiKey for ASR", "auth");
  }

  const model = resolveZaiAsrBillingModel();
  const form = new FormData();
  form.set("model", model);
  form.set("stream", "false");
  form.set("file", opts.file, opts.file.name || "audio");

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form,
      signal: controller.signal,
    });
    const raw = await response.text();
    let body: unknown = raw;
    if (raw) {
      try { body = JSON.parse(raw); } catch { /* preserve text */ }
    }
    if (!response.ok) {
      const obj = body && typeof body === "object" ? body as Record<string, unknown> : null;
      const nested = obj?.error && typeof obj.error === "object"
        ? obj.error as Record<string, unknown>
        : null;
      const message = String(nested?.message || obj?.message || raw || `HTTP ${response.status}`);
      throw new ZAIError(`ZAI ASR request failed: ${message}`, response.status >= 500 ? "server" : response.status === 429 ? "rate_limit" : response.status === 401 || response.status === 403 ? "auth" : "validation", { status: response.status, cause: body });
    }

    if (typeof body === "string" && body.trim()) return { text: body.trim(), model };
    const obj = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const nestedData = obj.data && typeof obj.data === "object" ? obj.data as Record<string, unknown> : null;
    const text = typeof obj.text === "string"
      ? obj.text
      : typeof nestedData?.text === "string"
        ? nestedData.text
        : typeof obj.transcript === "string"
          ? obj.transcript
          : "";
    if (!text.trim()) throw new ZAIError("ZAI ASR returned an empty transcription", "server", { cause: body });
    return { text: text.trim(), model };
  } catch (error) {
    if (error instanceof ZAIError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ZAIError(`ZAI ASR timed out after ${Math.round(timeoutMs / 1000)}s`, "timeout", { cause: error });
    }
    throw classifyError(error);
  } finally {
    clearTimeout(timer);
  }
}
