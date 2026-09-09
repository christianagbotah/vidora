import { getClient, ZAIError, classifyError } from "@/lib/zai";
import { getVideoModelInfo, viduAspectRatio, viduStyle } from "@/lib/video-models";

interface ZaiResolvedConfig {
  baseUrl?: string;
  apiKey?: string;
}

export interface ZaiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface BilledTextResult {
  content: string;
  usage: ZaiUsage | null;
  model: string;
}

function finiteUsage(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.ceil(n) : null;
}

function parseUsage(body: Record<string, unknown>): ZaiUsage | null {
  const raw = body.usage && typeof body.usage === "object"
    ? body.usage as Record<string, unknown>
    : null;
  if (!raw) return null;
  const input = finiteUsage(
    raw.prompt_tokens ?? raw.input_tokens ?? raw.promptTokens ?? raw.inputTokens,
  );
  const output = finiteUsage(
    raw.completion_tokens ?? raw.output_tokens ?? raw.completionTokens ?? raw.outputTokens,
  );
  if (input === null || output === null) return null;
  return { inputTokens: Math.max(1, input), outputTokens: Math.max(1, output) };
}

async function resolvedConfig(): Promise<{ baseUrl: string; apiKey: string }> {
  const client = await getClient();
  const config = (client as unknown as { config?: ZaiResolvedConfig }).config;
  if (!config?.baseUrl || !config.apiKey) {
    throw new ZAIError("ZAI client is missing baseUrl/apiKey for a paid provider request", "auth");
  }
  return { baseUrl: config.baseUrl.replace(/\/+$/, ""), apiKey: config.apiKey };
}

function responseError(body: unknown, status: number, label: string): ZAIError {
  const obj = body && typeof body === "object" ? body as Record<string, unknown> : null;
  const nested = obj?.error && typeof obj.error === "object"
    ? obj.error as Record<string, unknown>
    : null;
  const message = String(nested?.message || obj?.message || obj?.error || `HTTP ${status}`);
  const kind = status === 401 || status === 403
    ? "auth"
    : status === 429
      ? "rate_limit"
      : status >= 500
        ? "server"
        : "validation";
  return new ZAIError(`${label} failed: ${message}`, kind, { status, cause: body });
}

async function singleSubmitJson(opts: {
  path: string;
  body: unknown;
  timeoutMs: number;
  label: string;
}): Promise<Record<string, unknown>> {
  const config = await resolvedConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}${opts.path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(opts.body),
      signal: controller.signal,
      cache: "no-store",
    });
    const raw = await response.text();
    let body: unknown = raw;
    if (raw) {
      try { body = JSON.parse(raw); } catch { /* preserve raw response */ }
    }
    if (!response.ok) throw responseError(body, response.status, opts.label);
    if (!body || typeof body !== "object") {
      throw new ZAIError(`${opts.label} returned a non-JSON response`, "server", { cause: body });
    }
    const obj = body as Record<string, unknown>;
    if (obj.error) throw responseError(obj, 500, opts.label);
    return obj;
  } catch (error) {
    if (error instanceof ZAIError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ZAIError(
        `${opts.label} timed out; the reservation is held for reconciliation because provider acceptance is ambiguous`,
        "timeout",
        { cause: error },
      );
    }
    throw classifyError(error);
  } finally {
    clearTimeout(timer);
  }
}

function completionContent(body: Record<string, unknown>, label: string): string {
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const first = choices[0] && typeof choices[0] === "object"
    ? choices[0] as Record<string, unknown>
    : null;
  const message = first?.message && typeof first.message === "object"
    ? first.message as Record<string, unknown>
    : null;
  const content = typeof message?.content === "string" ? message.content.trim() : "";
  if (!content) throw new ZAIError(`${label} returned an empty completion`, "server", { cause: body });
  return content;
}

/**
 * Paid text transport: one exact-model submission, deliberately without an
 * automatic retry. A timeout/network failure can be ambiguous after provider
 * acceptance, so callers keep the reservation held for reconciliation.
 */
export async function submitBilledZaiText(opts: {
  model: string;
  systemPrompt?: string | null;
  userPrompt: string;
  maxOutputTokens: number;
  thinking?: "enabled" | "disabled";
  temperature?: number;
  timeoutMs?: number;
}): Promise<BilledTextResult> {
  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (opts.systemPrompt) messages.push({ role: "system", content: opts.systemPrompt });
  messages.push({ role: "user", content: opts.userPrompt });
  const body = await singleSubmitJson({
    path: "/chat/completions",
    body: {
      model: opts.model,
      messages,
      thinking: { type: opts.thinking ?? "disabled" },
      temperature: opts.temperature ?? 0.45,
      max_tokens: opts.maxOutputTokens,
    },
    timeoutMs: opts.timeoutMs ?? 90_000,
    label: `Paid Z.ai text (${opts.model})`,
  });
  return {
    content: completionContent(body, "Paid Z.ai text"),
    usage: parseUsage(body),
    model: opts.model,
  };
}

/** Exact-model, single-submit multimodal completion for paid analysis. */
export async function submitBilledZaiVision(opts: {
  model: string;
  messages: unknown[];
  maxOutputTokens: number;
  thinking?: "enabled" | "disabled";
  timeoutMs?: number;
}): Promise<BilledTextResult> {
  const body = await singleSubmitJson({
    path: "/chat/completions",
    body: {
      model: opts.model,
      messages: opts.messages,
      thinking: { type: opts.thinking ?? "enabled" },
      max_tokens: opts.maxOutputTokens,
    },
    timeoutMs: opts.timeoutMs ?? 180_000,
    label: `Paid Z.ai vision (${opts.model})`,
  });
  return {
    content: completionContent(body, "Paid Z.ai vision"),
    usage: parseUsage(body),
    model: opts.model,
  };
}

const PUBLIC_VIDEO_SIZES = new Set([
  "1280x720", "720x1280", "1024x1024", "1920x1080",
  "1080x1920", "2048x1080", "3840x2160",
]);
const SIZE_ALIASES: Record<string, string> = {
  "1080x1080": "1024x1024",
  "1440x1080": "1024x1024",
  "1080x1440": "1024x1024",
  "2560x1080": "2048x1080",
  "1080x2560": "1080x1920",
  "720x1440": "720x1280",
  "1440x720": "1280x720",
};

function publicVideoSize(size?: string): string | undefined {
  if (!size) return undefined;
  if (PUBLIC_VIDEO_SIZES.has(size)) return size;
  if (SIZE_ALIASES[size]) return SIZE_ALIASES[size];
  const [w, h] = size.split("x").map(Number);
  return Number.isFinite(w) && Number.isFinite(h) && w > h ? "1920x1080" : "1080x1920";
}

function exactImageForMode(
  imageUrl: string | string[] | undefined,
  mode: "none" | "single" | "array" | "any",
): string | string[] | undefined {
  if (mode === "none") return undefined;
  if (imageUrl === undefined) return undefined;
  if (mode === "single") return Array.isArray(imageUrl) ? imageUrl[0] : imageUrl;
  if (mode === "array") return (Array.isArray(imageUrl) ? imageUrl : [imageUrl]).slice(0, 7);
  return imageUrl;
}

/**
 * Paid video creation uses only the public exact-model contract. It never
 * falls back to another model, a model-less gateway default, or a second paid
 * submission after an ambiguous timeout/network failure.
 */
export async function submitBilledZaiVideo(opts: {
  model: string;
  prompt?: string;
  imageUrl?: string | string[];
  size?: string;
  aspectRatio?: string;
  style?: string;
  duration?: number;
  quality?: "speed" | "quality";
  withAudio?: boolean;
  timeoutMs?: number;
}): Promise<string> {
  const info = getVideoModelInfo(opts.model);
  if (!info || info.id !== opts.model) {
    throw new ZAIError(`Paid video model ${opts.model} is not recognized by Vidora`, "validation");
  }
  const prompt = opts.prompt?.slice(0, 500);
  const image = exactImageForMode(opts.imageUrl, info.imageMode);
  const providerBody: Record<string, unknown> = info.family === "cogvideox"
    ? {
        model: info.id,
        ...(prompt ? { prompt } : {}),
        ...(image !== undefined ? { image_url: image } : {}),
        ...(opts.size ? { size: publicVideoSize(opts.size) } : {}),
        duration: Number(opts.duration ?? info.durationSec) <= 7.5 ? 5 : 10,
        quality: opts.quality ?? "quality",
        with_audio: opts.withAudio ?? true,
      }
    : {
        model: info.id,
        ...(prompt ? { prompt } : {}),
        ...(image !== undefined ? { image_url: image } : {}),
        ...(opts.aspectRatio ? { aspect_ratio: viduAspectRatio(opts.aspectRatio) } : {}),
        movement_amplitude: "auto",
        ...(info.supportsStyle ? { style: viduStyle(opts.style) } : {}),
        duration: info.durationSec,
      };
  const body = await singleSubmitJson({
    path: "/videos/generations",
    body: providerBody,
    timeoutMs: opts.timeoutMs ?? 120_000,
    label: `Paid Z.ai video (${info.id})`,
  });
  const taskId = typeof body.id === "string" ? body.id : "";
  if (!taskId) throw new ZAIError("Paid Z.ai video request returned no task id", "server", { cause: body });
  return taskId;
}

async function downloadImage(url: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error(`generated image download returned HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer()).toString("base64");
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw classifyError(lastError);
}

/** Exact-model, single-submit paid image generation. */
export async function submitBilledZaiImage(opts: {
  model: string;
  prompt: string;
  size?: string;
  timeoutMs?: number;
}): Promise<string> {
  const body = await singleSubmitJson({
    path: "/images/generations",
    body: { model: opts.model, prompt: opts.prompt, size: opts.size ?? "1024x1024" },
    timeoutMs: opts.timeoutMs ?? 120_000,
    label: `Paid Z.ai image (${opts.model})`,
  });
  const data = Array.isArray(body.data) ? body.data : [];
  const first = data[0] && typeof data[0] === "object" ? data[0] as Record<string, unknown> : null;
  const base64 = typeof first?.base64 === "string"
    ? first.base64
    : typeof first?.b64_json === "string"
      ? first.b64_json
      : "";
  if (base64) return base64;
  if (typeof first?.url === "string" && first.url) return downloadImage(first.url);
  throw new ZAIError("Paid Z.ai image request returned no image data", "server", { cause: body });
}
