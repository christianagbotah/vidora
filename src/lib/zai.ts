/**
 * ───────────────────────────────────────────────────────────────────────────
 *  Vidora — Enterprise ZAI Client Wrapper
 * ───────────────────────────────────────────────────────────────────────────
 *
 *  Centralizes ALL z-ai-web-dev-sdk interactions with:
 *   • Singleton client (reads .z-ai-config once, cached globally)
 *   • Typed error classification (rate-limit / timeout / network / auth / server / validation)
 *   • Unified exponential-backoff retry (only retryable error classes)
 *   • Per-call timeouts via AbortController (no more hung HTTP requests)
 *   • Sensible defaults (thinking: disabled, model selection)
 *   • Specialized helpers: chat, vision, image, video, pollVideoTask, tts, asr
 *
 *  Every API route MUST import { zai } from "@/lib/zai" instead of calling
 *  ZAI.create() directly. This guarantees consistent resilience.
 * ───────────────────────────────────────────────────────────────────────────
 */

import ZAI from "z-ai-web-dev-sdk";
import type {
  CreateChatCompletionBody,
  CreateChatCompletionVisionBody,
  CreateImageGenerationBody,
  CreateImageEditBody,
  CreateVideoGenerationBody,
  CreateAudioTTSBody,
  CreateAudioASRBody,
  AsyncResultResponse,
  ImageGenerationResponse,
} from "z-ai-web-dev-sdk";

// ─── Error Classification ───────────────────────────────────────────────────

export type ZAIErrorKind =
  | "auth"
  | "rate_limit"
  | "timeout"
  | "network"
  | "server"
  | "validation"
  | "unknown";

export class ZAIError extends Error {
  readonly kind: ZAIErrorKind;
  readonly retryable: boolean;
  readonly status?: number;
  readonly cause?: unknown;

  constructor(message: string, kind: ZAIErrorKind, opts?: { status?: number; cause?: unknown }) {
    super(message);
    this.name = "ZAIError";
    this.kind = kind;
    this.status = opts?.status;
    this.cause = opts?.cause;
    // Rate-limit, network, timeout, and 5xx server errors are worth retrying.
    this.retryable =
      kind === "rate_limit" || kind === "network" || kind === "timeout" || kind === "server";
  }
}

/**
 * Inspect a thrown value and classify it into a ZAIError.
 * The SDK throws generic Error instances whose .message sometimes contains
 * the HTTP status code or a fetch-level description.
 *
 * Importantly: when the API returns an error like
 *   "API request failed with status 429: {"error":{"code":"1113","message":"Insufficient balance..."}}"
 * we parse out the real API message so it surfaces to the user instead of a
 * generic "rate limit reached" placeholder.
 */
function classifyError(err: unknown): ZAIError {
  if (err instanceof ZAIError) return err;

  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  // Try to extract a JSON error body from the SDK's error string.
  // The SDK formats errors as: "API request failed with status XXX: {json}"
  const jsonMatch = raw.match(/\{[\s\S]*"error"[\s\S]*\}/);
  let apiMessage: string | undefined;
  let apiCode: string | undefined;
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed?.error) {
        if (typeof parsed.error === "object") {
          apiMessage = parsed.error.message;
          apiCode = String(parsed.error.code ?? "");
        } else if (typeof parsed.error === "string") {
          apiMessage = parsed.error;
        }
      }
    } catch { /* not JSON, ignore */ }
  }

  // AbortController / timeout
  if (lower.includes("aborted") || lower.includes("timeout") || lower.includes("timed out")) {
    return new ZAIError(raw, "timeout", { cause: err });
  }
  // Network-level fetch failures ("fetch failed", ECONNRESET, ENOTFOUND, etc.)
  if (
    lower.includes("fetch failed") ||
    lower.includes("econnreset") ||
    lower.includes("enotfound") ||
    lower.includes("econnrefused") ||
    lower.includes("network") ||
    lower.includes("socket hang up")
  ) {
    return new ZAIError(raw, "network", { cause: err });
  }
  // Auth / config
  if (lower.includes("config") && lower.includes("not found")) {
    return new ZAIError(
      "ZAI configuration file (.z-ai-config) is missing or invalid. Create it with baseUrl and apiKey.",
      "auth",
      { cause: err }
    );
  }
  if (lower.includes("unauthorized") || lower.includes("invalid api key") || lower.includes("401")) {
    return new ZAIError("ZAI authentication failed — check the apiKey in .z-ai-config.", "auth", {
      cause: err,
    });
  }

  // Insufficient balance / quota (code 1113 or 1112) — surface the real message
  if (apiCode === "1113" || apiCode === "1112" || lower.includes("insufficient balance")) {
    return new ZAIError(
      apiMessage || "ZAI account has insufficient balance. Please recharge your Z.ai account.",
      "auth", // not retryable — billing issue
      { cause: err }
    );
  }

  // Unknown model (code 1211) — validation error, surface the real message
  if (apiCode === "1211" || lower.includes("unknown model")) {
    return new ZAIError(apiMessage || "ZAI unknown model. Please check the model name.", "validation", {
      cause: err,
    });
  }

  // Rate limiting (genuine 429 with rate-limit semantics, NOT balance issues)
  if (lower.includes("rate limit") || lower.includes("too many requests")) {
    return new ZAIError(apiMessage || "ZAI rate limit reached. Please retry shortly.", "rate_limit", { cause: err });
  }

  // The SDK throws "API request failed with status XXX" — if we extracted an
  // apiMessage, use it; otherwise use the raw SDK message.
  if (lower.includes("api request failed with status 429")) {
    // 429 without explicit rate-limit text — could be balance or rate limit.
    // If we have an apiMessage, surface it; classify as rate_limit (retryable).
    return new ZAIError(apiMessage || "ZAI rate limit reached. Please retry shortly.", "rate_limit", { cause: err });
  }

  // Validation (4xx, non-retryable)
  if (
    lower.includes("400") ||
    lower.includes("422") ||
    lower.includes("bad request") ||
    (lower.includes("invalid") && !apiMessage)
  ) {
    return new ZAIError(apiMessage || raw, "validation", { cause: err });
  }

  // Server 5xx
  if (
    lower.includes("500") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("504") ||
    lower.includes("internal server error") ||
    lower.includes("bad gateway") ||
    lower.includes("service unavailable") ||
    lower.includes("gateway timeout")
  ) {
    return new ZAIError(apiMessage || raw, "server", { cause: err });
  }

  // TypeError from SDK internal code (e.g. result.data.map on undefined)
  if (err instanceof TypeError && lower.includes("undefined")) {
    return new ZAIError(
      "ZAI API call failed — the service may have returned an error response. Check account balance and model availability.",
      "server",
      { cause: err }
    );
  }

  // If we extracted an apiMessage but didn't match a specific kind, surface it
  if (apiMessage) {
    return new ZAIError(apiMessage, "server", { cause: err });
  }

  return new ZAIError(raw, "unknown", { cause: err });
}

// ─── Retry / Timeout Primitives ─────────────────────────────────────────────

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  label?: string;
}

const DEFAULT_RETRY: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 15000,
  timeoutMs: 60_000, // 60s per attempt by default
  label: "ZAI call",
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ZAIError("Aborted during backoff", "timeout"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new ZAIError("Aborted during backoff", "timeout"));
      },
      { once: true }
    );
  });
}

/** Exponential backoff with jitter: delay = min(maxDelay, base * 2^(attempt-1)) + jitter */
function backoffDelay(attempt: number, base: number, max: number): number {
  const exp = Math.min(max, base * Math.pow(2, attempt - 1));
  const jitter = Math.floor(Math.random() * 500); // 0–499ms jitter to avoid thundering herd
  return exp + jitter;
}

/**
 * Run an async operation with a timeout and retry-on-retryable-error semantics.
 */
async function withRetry<T>(fn: (signal: AbortSignal) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const config = { ...DEFAULT_RETRY, ...opts };
  const { maxRetries, baseDelayMs, maxDelayMs, timeoutMs, label } = config;

  let lastError: ZAIError | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Per-attempt timeout via AbortController
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await fn(controller.signal);
      clearTimeout(timer);
      return result;
    } catch (err) {
      clearTimeout(timer);
      const classified = classifyError(err);
      lastError = classified;

      // Non-retryable → throw immediately
      if (!classified.retryable || attempt === maxRetries) {
        if (classified.retryable) {
          console.error(`[ZAI] ${label} failed after ${maxRetries} attempts:`, classified.message);
        } else {
          console.error(`[ZAI] ${label} failed (non-retryable ${classified.kind}):`, classified.message);
        }
        throw classified;
      }

      const delay = backoffDelay(attempt, baseDelayMs, maxDelayMs);
      console.warn(
        `[ZAI] ${label} attempt ${attempt}/${maxRetries} failed (${classified.kind}), retrying in ${delay}ms…`
      );
      await sleep(delay, controller.signal);
    }
  }

  throw lastError ?? new ZAIError(`${label}: exhausted retries`, "unknown");
}

// ─── Singleton Client ───────────────────────────────────────────────────────

type ZAIInstance = Awaited<ReturnType<typeof ZAI.create>>;

const globalForZAI = globalThis as unknown as { __zaiClient?: ZAIInstance };

let clientPromise: Promise<ZAIInstance> | null = null;

/**
 * Get the cached singleton ZAI client. The SDK reads .z-ai-config on first
 * create() and we cache the instance for the lifetime of the process.
 */
export function getClient(): Promise<ZAIInstance> {
  if (globalForZAI.__zaiClient) return Promise.resolve(globalForZAI.__zaiClient);
  if (!clientPromise) {
    clientPromise = ZAI.create().then((instance) => {
      globalForZAI.__zaiClient = instance;
      return instance;
    });
  }
  return clientPromise;
}

// ─── Response body error detection ──────────────────────────────────────────

/**
 * The ZAI API sometimes returns HTTP 200 with an error body like
 * `{ "error": { "code": "1113", "message": "Insufficient balance..." } }`.
 * The SDK's `response.ok` check passes, so the error surfaces as an empty
 * completion. This helper inspects the parsed body and throws a proper
 * ZAIError if it contains an error field.
 */
function assertNoBodyError(body: unknown, label: string): void {
  if (!body || typeof body !== "object") return;
  const obj = body as Record<string, unknown>;
  if (obj.error && typeof obj.error === "object") {
    const err = obj.error as Record<string, unknown>;
    const code = String(err.code ?? "");
    const message = String(err.message ?? "");
    // Map known error codes to kinds
    let kind: ZAIErrorKind = "server";
    if (code === "1113" || code === "1112") {
      // Insufficient balance / quota — not retryable, surfaces a clear message
      kind = "auth";
    } else if (code === "1211") {
      // Unknown model — validation error
      kind = "validation";
    } else if (code === "429" || message.toLowerCase().includes("rate limit")) {
      kind = "rate_limit";
    }
    throw new ZAIError(
      message || `ZAI API error (code ${code}) during ${label}`,
      kind,
      { cause: body }
    );
  }
  // Also handle flat error string
  if (typeof obj.error === "string" && obj.error) {
    throw new ZAIError(`${obj.error} (during ${label})`, "server", { cause: body });
  }
}

// ─── Specialized Helpers ────────────────────────────────────────────────────

export interface ChatOptions {
  systemPrompt?: string;
  userPrompt: string;
  model?: string;
  thinking?: "enabled" | "disabled";
  /** Override retry/timeout behavior */
  retry?: RetryOptions;
  /** Extra body fields (temperature, max_tokens, etc.) */
  extra?: Record<string, unknown>;
}

/**
 * Chat completion. Defaults to thinking: disabled (fast, cheap, deterministic).
 * Returns the trimmed text content of the first choice.
 */
export async function chat(opts: ChatOptions): Promise<string> {
  const zai = await getClient();
  const messages: CreateChatCompletionBody["messages"] = [];
  if (opts.systemPrompt) messages.push({ role: "system", content: opts.systemPrompt });
  messages.push({ role: "user", content: opts.userPrompt });

  const body: CreateChatCompletionBody = {
    // Default model: glm-4.5 (Z.ai's flagship chat model). Always specify a
    // model so the API returns a clear error (e.g. "Insufficient balance")
    // instead of a generic code-500 with no message.
    model: opts.model ?? "glm-4.5",
    messages,
    thinking: { type: opts.thinking ?? "disabled" },
    ...(opts.extra ?? {}),
  };

  const completion = await withRetry(
    (signal) => {
      // The SDK doesn't accept an AbortSignal directly, but we wrap it so the
      // timeout above still rejects the outer promise if the call hangs.
      return Promise.race([
        zai.chat.completions.create(body),
        new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => reject(new ZAIError("Chat completion timed out", "timeout")), {
            once: true,
          });
        }),
      ]);
    },
    { label: "ZAI chat completion", ...opts.retry }
  );

  // The API can return HTTP 200 with an error body — detect it before
  // checking for empty content.
  assertNoBodyError(completion, "chat completion");

  const content = completion?.choices?.[0]?.message?.content;
  if (!content) {
    throw new ZAIError("ZAI returned an empty chat completion (no content in choices[0])", "server");
  }
  return content.trim();
}

export interface VisionOptions {
  model: string;
  messages: CreateChatCompletionVisionBody["messages"];
  thinking?: "enabled" | "disabled";
  retry?: RetryOptions;
}

/** Vision (multimodal) chat completion. Requires a model (e.g. "glm-4v"). */
export async function vision(opts: VisionOptions): Promise<string> {
  const zai = await getClient();
  const body: CreateChatCompletionVisionBody = {
    model: opts.model,
    messages: opts.messages,
    thinking: { type: opts.thinking ?? "enabled" },
  };

  const completion = await withRetry(
    (signal) =>
      Promise.race([
        zai.chat.completions.createVision(body),
        new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => reject(new ZAIError("Vision completion timed out", "timeout")), {
            once: true,
          });
        }),
      ]),
    { label: "ZAI vision completion", timeoutMs: 120_000, ...opts.retry }
  );

  assertNoBodyError(completion, "vision completion");

  const content = completion?.choices?.[0]?.message?.content;
  if (!content) {
    throw new ZAIError("ZAI returned an empty vision completion (no content in choices[0])", "server");
  }
  return content.trim();
}

export interface ImageOptions {
  prompt: string;
  size?: CreateImageGenerationBody["size"];
  retry?: RetryOptions;
}

/** Generate an image, returning the base64 string of the first result. */
export async function generateImage(opts: ImageOptions): Promise<string> {
  const zai = await getClient();
  const body: CreateImageGenerationBody = {
    prompt: opts.prompt,
    size: opts.size ?? "1024x1024",
  };

  let res: ImageGenerationResponse;
  try {
    res = await withRetry(
      (signal) =>
        Promise.race([
          zai.images.generations.create(body),
          new Promise<never>((_, reject) => {
            signal.addEventListener("abort", () => reject(new ZAIError("Image generation timed out", "timeout")), {
              once: true,
            });
          }),
        ]),
      { label: "ZAI image generation", timeoutMs: 120_000, maxRetries: 4, ...opts.retry }
    );
  } catch (err) {
    // The SDK internally does `result.data.map(...)` which throws a TypeError
    // if the API returned an error body like { error: {...} } (no `data` field).
    // Re-classify this as a server error with a helpful message.
    if (err instanceof TypeError && err.message.includes("undefined")) {
      throw new ZAIError(
        "ZAI image generation failed — the API may have returned an error (check account balance/model availability)",
        "server",
        { cause: err }
      );
    }
    throw err;
  }

  assertNoBodyError(res, "image generation");

  const base64 = res?.data?.[0]?.base64;
  if (!base64) {
    throw new ZAIError("ZAI image generation returned no image data", "server");
  }
  return base64;
}

export interface VideoOptions {
  prompt?: string;
  imageUrl?: string | string[];
  size?: string;
  duration?: number;
  quality?: "speed" | "quality";
  withAudio?: boolean;
  retry?: RetryOptions;
}

/** Kick off a video generation task. Returns the task ID for polling. */
export async function generateVideo(opts: VideoOptions): Promise<string> {
  const zai = await getClient();
  const body: CreateVideoGenerationBody = {
    prompt: opts.prompt,
    size: opts.size,
    duration: opts.duration,
    quality: opts.quality ?? "quality",
    with_audio: opts.withAudio ?? true,
    ...(opts.imageUrl ? { image_url: opts.imageUrl } : {}),
  };

  const res = await withRetry(
    (signal) =>
      Promise.race([
        zai.video.generations.create(body),
        new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => reject(new ZAIError("Video generation timed out", "timeout")), {
            once: true,
          });
        }),
      ]),
    { label: "ZAI video generation", timeoutMs: 120_000, maxRetries: 4, ...opts.retry }
  );

  assertNoBodyError(res, "video generation");

  const taskId = res?.id;
  if (!taskId) {
    throw new ZAIError(
      `ZAI video generation did not return a task ID (status: ${res?.task_status ?? "unknown"})`,
      "server"
    );
  }
  return taskId;
}

export interface PollVideoOptions {
  taskId: string;
  /** Max polling attempts (default 80 → ~20 min at 15s interval) */
  maxAttempts?: number;
  /** Interval between polls in ms (default 15_000) */
  intervalMs?: number;
}

export interface PollVideoResult {
  status: "success" | "failed" | "timeout";
  videoUrl?: string;
  raw?: AsyncResultResponse;
  error?: string;
}

/**
 * Poll the async-result endpoint until the video task completes, fails, or times out.
 */
export async function pollVideoTask(opts: PollVideoOptions): Promise<PollVideoResult> {
  const zai = await getClient();
  const maxAttempts = opts.maxAttempts ?? 80;
  const intervalMs = opts.intervalMs ?? 15_000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res: AsyncResultResponse = await zai.async.result.query(opts.taskId);

      if (res.task_status === "SUCCESS") {
        const videoUrl =
          res.video_result?.[0]?.url ||
          res.video_url ||
          res.url ||
          res.video;
        if (videoUrl) {
          return { status: "success", videoUrl, raw: res };
        }
        // SUCCESS but no URL — treat as failed
        return { status: "failed", raw: res, error: "Task marked SUCCESS but no video URL was returned" };
      }

      if (res.task_status === "FAIL") {
        return { status: "failed", raw: res, error: "Video generation task failed on the server" };
      }

      // PROCESSING — wait and retry
      if (attempt < maxAttempts) {
        await sleep(intervalMs);
      }
    } catch (err) {
      const classified = classifyError(err);
      // Network blips during polling are recoverable — keep polling if attempts remain
      if (classified.retryable && attempt < maxAttempts) {
        console.warn(`[ZAI] pollVideoTask attempt ${attempt} transient error: ${classified.message}`);
        await sleep(intervalMs);
        continue;
      }
      return { status: "failed", error: classified.message };
    }
  }

  return { status: "timeout", error: `Video generation did not complete within ${Math.round((maxAttempts * intervalMs) / 60000)} minutes` };
}

export interface TTSOptions {
  input: string;
  voice?: string;
  speed?: number;
  responseFormat?: string;
  retry?: RetryOptions;
}

/**
 * Text-to-speech. Returns an ArrayBuffer of the audio (mp3 by default).
 * The SDK returns a Response-like object; we extract the buffer.
 */
export async function tts(opts: TTSOptions): Promise<ArrayBuffer> {
  const zai = await getClient();
  const body: CreateAudioTTSBody = {
    input: opts.input,
    voice: opts.voice ?? "tongtong",
    response_format: opts.responseFormat ?? "mp3",
    speed: opts.speed ?? 1,
    stream: false,
  };

  const response = await withRetry(
    (signal) =>
      Promise.race([
        zai.audio.tts.create(body),
        new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => reject(new ZAIError("TTS timed out", "timeout")), { once: true });
        }),
      ]),
    { label: "ZAI TTS", timeoutMs: 120_000, maxRetries: 4, ...opts.retry }
  );

  // SDK returns a fetch Response — use arrayBuffer()
  if (response && typeof response.arrayBuffer === "function") {
    return response.arrayBuffer();
  }
  throw new ZAIError("ZAI TTS returned an unexpected response shape", "server");
}

export interface ASROptions {
  /** base64-encoded audio */
  fileBase64: string;
  retry?: RetryOptions;
}

/** Speech recognition. Returns the transcribed text. */
export async function asr(opts: ASROptions): Promise<string> {
  const zai = await getClient();
  const body: CreateAudioASRBody = {
    file_base64: opts.fileBase64,
  };

  const response = await withRetry(
    (signal) =>
      Promise.race([
        zai.audio.asr.create(body),
        new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => reject(new ZAIError("ASR timed out", "timeout")), { once: true });
        }),
      ]),
    { label: "ZAI ASR", timeoutMs: 120_000, maxRetries: 3, ...opts.retry }
  );

  // The ASR response shape varies — try common fields.
  // First check for an error body (HTTP 200 with { error: ... }).
  assertNoBodyError(response, "ASR");
  if (typeof response === "string") return response;
  if (response?.text) return response.text;
  if (response?.data?.text) return response.data.text;
  if (response?.transcript) return response.transcript;

  throw new ZAIError("ZAI ASR returned an unexpected response shape", "server");
}

// ─── Convenience: strip markdown fences from LLM output ─────────────────────

/** Strip ```lang ... ``` fences and surrounding quotes from LLM output. */
export function cleanLLMOutput(text: string): string {
  return text
    .replace(/^```[a-zA-Z]*\s*\n?/, "")
    .replace(/\n?```$/, "")
    .replace(/^["'`]|["'`]$/g, "")
    .trim();
}

// ─── Default export: namespaced API ─────────────────────────────────────────

export const zai = {
  chat,
  vision,
  generateImage,
  generateVideo,
  pollVideoTask,
  tts,
  asr,
  getClient,
  cleanLLMOutput,
  ZAIError,
};

export default zai;
