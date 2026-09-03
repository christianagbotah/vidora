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
  CreateAudioTTSBody,
  CreateAudioASRBody,
  AsyncResultResponse,
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
    // Network, timeout, and 5xx server errors are worth retrying.
    // Rate-limit errors are NOT retryable here because the cooldown window
    // (often minutes for video gen) far exceeds exponential backoff delays.
    // Callers who want to retry rate limits should do so with their own
    // longer delay strategy.
    this.retryable =
      kind === "network" || kind === "timeout" || kind === "server";
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
export function classifyError(err: unknown): ZAIError {
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

  // 404 Not Found — endpoint doesn't exist on this API instance.
  // Common for video generation: the account may not have video API access.
  if (lower.includes("status 404")) {
    // If the path mentions "/video/", give a specific message
    if (lower.includes("/video/")) {
      return new ZAIError(
        "Video generation API not available (404). Your ZAI account may not have video generation access, or the base URL doesn't support this endpoint.",
        "validation",
        { cause: err, status: 404 }
      );
    }
    return new ZAIError(apiMessage || raw, "validation", { cause: err, status: 404 });
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
 * Get the cached singleton ZAI client.
 *
 * CONFIG RESOLUTION ORDER:
 *   1. SystemConfig DB (zai_base_url + zai_api_key) — set via Admin Portal
 *   2. ZAI_BASE_URL + ZAI_API_KEY env vars — server environment
 *   3. .z-ai-config file via ZAI.create() — dev sandbox fallback
 */
export function getClient(): Promise<ZAIInstance> {
  if (globalForZAI.__zaiClient) return Promise.resolve(globalForZAI.__zaiClient);
  if (!clientPromise) {
    clientPromise = buildClient();
  }
  return clientPromise;
}

async function buildClient(): Promise<ZAIInstance> {
  // 1. Check database first (admin portal config)
  try {
    const { db } = await import("@/lib/db");
    const [baseUrlRow, apiKeyRow] = await Promise.all([
      db.systemConfig.findUnique({ where: { key: "zai_base_url" } }),
      db.systemConfig.findUnique({ where: { key: "zai_api_key" } }),
    ]);
    const dbBaseUrl = baseUrlRow?.value;
    const dbApiKey = apiKeyRow?.value;
    if (dbBaseUrl && dbApiKey) {
      const client = constructClient(dbBaseUrl, dbApiKey);
      globalForZAI.__zaiClient = client;
      return client;
    }
  } catch {
    // DB not available (e.g. during build) — fall through to env vars
  }

  // 2. Environment variables
  const envBaseUrl = process.env.ZAI_BASE_URL;
  const envApiKey = process.env.ZAI_API_KEY;
  if (envBaseUrl && envApiKey) {
    const client = constructClient(envBaseUrl, envApiKey);
    globalForZAI.__zaiClient = client;
    return client;
  }

  // 3. Dev fallback: let the SDK read .z-ai-config from disk
  try {
    const instance = await ZAI.create();
    globalForZAI.__zaiClient = instance;
    return instance;
  } catch (sdkErr) {
    const raw = sdkErr instanceof Error ? sdkErr.message : String(sdkErr);
    throw new ZAIError(
      `No ZAI credentials configured. Set them via Admin Portal (zai_base_url + zai_api_key), env vars (ZAI_BASE_URL + ZAI_API_KEY), or .z-ai-config file. SDK said: ${raw}`,
      "auth",
      { cause: sdkErr }
    );
  }
}

export function constructClient(baseUrl: string, apiKey: string): ZAIInstance {
  type ZAIConstructor = new (config: {
    baseUrl: string;
    apiKey: string;
    chatId?: string;
    userId?: string;
    token?: string;
  }) => ZAIInstance;
  const instance = new (ZAI as unknown as ZAIConstructor)({
    baseUrl,
    apiKey,
  });
  return instance;
}

/**
 * Invalidate the cached singleton. Called by the admin config route after
 * ZAI credentials are updated, so the next API call creates a fresh client
 * with the new values from the database.
 */
export function resetZaiClient(): void {
  globalForZAI.__zaiClient = undefined;
  clientPromise = null;
  cachedEndpointConfig = null;
  lastGoodVideoDuration = null;
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
    const msgLower = obj.error.toLowerCase();
    // Classify "too many requests" as rate_limit so callers can handle it
    // differently (longer backoff, no immediate retry, user-friendly message)
    if (msgLower.includes("too many requests") || msgLower.includes("rate limit")) {
      throw new ZAIError(`${obj.error} (during ${label})`, "rate_limit", { cause: body });
    }
    throw new ZAIError(`${obj.error} (during ${label})`, "server", { cause: body });
  }
  // Public api.z.ai error wrapper: HTTP 200 with { "code": 123, "message": "..." }
  // (e.g. a missing required field can produce this instead of a 4xx). Only
  // treat it as an error when the body has no success payload fields.
  if (
    typeof obj.code === "number" &&
    typeof obj.message === "string" &&
    obj.message &&
    obj.data === undefined &&
    obj.choices === undefined &&
    obj.id === undefined &&
    obj.task_status === undefined
  ) {
    const msgLower = obj.message.toLowerCase();
    let kind: ZAIErrorKind = "server";
    if (obj.code === 1113 || obj.code === 1112 || msgLower.includes("balance")) {
      kind = "auth";
    } else if (obj.code === 429 || msgLower.includes("rate limit") || msgLower.includes("too many requests")) {
      kind = "rate_limit";
    } else if (obj.code === 1211 || msgLower.includes("model")) {
      kind = "validation";
    }
    throw new ZAIError(
      `ZAI API error (code ${obj.code}) during ${label}: ${obj.message}`,
      kind,
      { cause: body }
    );
  }
}

// ─── Video Endpoint Compatibility (public API vs internal gateway) ─────────
//
// WHY THIS EXISTS:
// The z-ai-web-dev-sdk (v0.0.18) video methods target the INTERNAL Z.ai
// gateway (internal-api.z.ai/v1):
//     create: POST {baseUrl}/video/generation         (singular path, no model)
//     poll:   GET  {baseUrl}/async-result?id={taskId} (query parameter)
//
// The PUBLIC api.z.ai (https://api.z.ai/api/paas/v4) uses DIFFERENT routes:
//     create: POST {baseUrl}/videos/generations       (plural path, `model` REQUIRED)
//     poll:   GET  {baseUrl}/async-result/{taskId}    (path parameter)
//
// Deployments configured with the public API (e.g. a VPS via the Admin
// Portal) therefore received 404 "Not Found" on EVERY video create/poll,
// even though the tasks themselves succeed server-side.
//
// The compat helpers below try the public form first and fall back to the
// SDK/internal form when the route is missing. This is safe because on both
// servers an HTTP 404 means "route not found" — a missing or expired task
// returns 400 + error body {"error":{"code":"1233","message":"...does not exist"}}.

interface ZAIRawConfig {
  baseUrl: string;
  apiKey: string;
  chatId?: string;
  userId?: string;
  token?: string;
}

let cachedEndpointConfig: ZAIRawConfig | null = null;

/**
 * Read the resolved connection config (baseUrl/apiKey + optional gateway
 * headers) from the singleton ZAI instance. Works no matter where the
 * credentials came from: SystemConfig DB, env vars, or .z-ai-config file.
 */
async function getEndpointConfig(): Promise<ZAIRawConfig> {
  if (cachedEndpointConfig) return cachedEndpointConfig;
  const client = await getClient();
  // `config` is private in the SDK's type declarations but stable across
  // v0.0.x and the only reliable source of the fully-resolved connection.
  const cfg = (client as unknown as { config?: ZAIRawConfig }).config;
  if (!cfg?.baseUrl || !cfg?.apiKey) {
    throw new ZAIError(
      "ZAI client is missing baseUrl/apiKey — cannot build video endpoints",
      "auth"
    );
  }
  cachedEndpointConfig = {
    ...cfg,
    baseUrl: cfg.baseUrl.replace(/\/+$/, ""),
  };
  return cachedEndpointConfig;
}

interface ZaiRequestResult {
  status: number;
  body: unknown;
}

/** Authenticated JSON request against the configured Z.ai endpoint,
 * with an AbortController timeout. Returns status + parsed body. */
async function zaiRequest(
  url: string,
  init: { method: "GET" | "POST"; bodyJson?: unknown },
  timeoutMs: number
): Promise<ZaiRequestResult> {
  const cfg = await getEndpointConfig();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.apiKey}`,
    "X-Z-AI-From": "Z",
  };
  if (cfg.chatId) headers["X-Chat-Id"] = cfg.chatId;
  if (cfg.userId) headers["X-User-Id"] = cfg.userId;
  if (cfg.token) headers["X-Token"] = cfg.token;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: init.method,
      headers,
      ...(init.bodyJson !== undefined
        ? { body: JSON.stringify(init.bodyJson) }
        : {}),
      signal: controller.signal,
    });
    const text = await res.text();
    let body: unknown = text;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        // non-JSON body — keep the raw text
      }
    }
    return { status: res.status, body };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ZAIError(
        `Request to ${url} timed out after ${Math.round(timeoutMs / 1000)}s`,
        "timeout"
      );
    }
    throw classifyError(err); // network errors etc.
  } finally {
    clearTimeout(timer);
  }
}

function extractApiErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  if (obj.error && typeof obj.error === "object") {
    const err = obj.error as Record<string, unknown>;
    if (err.message) return String(err.message);
    if (err.code) return `error code ${err.code}`;
  }
  if (typeof obj.error === "string" && obj.error) return obj.error;
  if (typeof obj.message === "string" && obj.message) return obj.message;
  return null;
}

function statusToErrorKind(status: number): ZAIErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  return "validation"; // 400/404/422 — not worth retrying verbatim
}

export interface VideoTaskCreateResult {
  id?: string;
  task_status?: string;
  [key: string]: unknown;
}

const DEFAULT_VIDEO_MODEL = "CogVideoX-3";

// ─── Public API constraint normalization ────────────────────────────────────
//
// The public api.z.ai documents (docs.z.ai → Video API → Generate Video):
//   * duration: enum of exactly 5 or 10 seconds (default 5)
//   * size:     1280x720, 720x1280, 1024x1024, 1920x1080, 1080x1920,
//               2048x1080, 3840x2160
//   * prompt:   maximum 512 characters
// The app derives per-scene durations from project settings (e.g. a 30s
// project ÷ 4 scenes = 7s, or the raw targetDuration on older paths) and
// maps aspect ratios to sizes like 1080x1080 — none of which the public
// API accepts. The internal gateway is more permissive, so normalization
// is applied to the PUBLIC endpoint form only.

const SUPPORTED_VIDEO_DURATIONS = [5, 10];

const PUBLIC_VIDEO_SIZES = new Set([
  "1280x720",
  "720x1280",
  "1024x1024",
  "1920x1080",
  "1080x1920",
  "2048x1080",
  "3840x2160",
]);

/** Aspect-ratio sizes the app uses that the public API doesn't support,
 *  mapped to the closest supported equivalent. */
const PUBLIC_VIDEO_SIZE_ALIASES: Record<string, string> = {
  "1080x1080": "1024x1024", // 1:1
  "1440x1080": "1024x1024", // 4:3 — public has no 4:3; 1:1 is closest
  "1080x1440": "1024x1024", // 3:4
  "2560x1080": "2048x1080", // 21:9 — widest public size
  "1080x2560": "1080x1920", // 9:21 ultratall
  "720x1440": "720x1280",
  "1440x720": "1280x720",
};

/** Map an arbitrary requested size to one the public API accepts.
 *  Unknown sizes fall back by orientation. */
function normalizeVideoSizeForPublic(size?: string): string | undefined {
  if (!size) return size;
  if (PUBLIC_VIDEO_SIZES.has(size)) return size;
  const aliased = PUBLIC_VIDEO_SIZE_ALIASES[size];
  if (aliased) return aliased;
  const [w, h] = size.split("x").map(Number);
  return w > h ? "1920x1080" : "1080x1920";
}

// Duration that last succeeded on this infrastructure ("omit" = the request
// succeeded with no duration field). Null until the first success. Cached so
// later scenes skip the probing attempts.
let lastGoodVideoDuration: number | "omit" | null = null;

/** Clamp an arbitrary requested duration to the public enum (5s/10s). */
function clampVideoDuration(requested: number): number {
  if (SUPPORTED_VIDEO_DURATIONS.includes(requested)) return requested;
  return requested <= 7.5 ? 5 : 10;
}

/** Candidate durations to try, in order: forced env override → last-known-good
 *  → clamped requested → 5 → omit-the-field (API default is 5). */
function videoDurationCandidates(requested?: number): (number | undefined)[] {
  const forcedRaw = process.env.ZAI_VIDEO_DURATION;
  if (forcedRaw) {
    const forced = Number(forcedRaw);
    if (Number.isFinite(forced)) return [forced]; // operator override — no ladder
  }
  const normalized =
    requested != null && Number.isFinite(requested)
      ? clampVideoDuration(requested)
      : undefined;
  const candidates: (number | undefined)[] = [];
  const push = (v: number | undefined) => {
    if (!candidates.includes(v)) candidates.push(v);
  };
  if (lastGoodVideoDuration !== null) {
    push(lastGoodVideoDuration === "omit" ? undefined : lastGoodVideoDuration);
  }
  push(normalized);
  push(5);
  push(undefined);
  return candidates;
}

/**
 * Create a video generation task, working on BOTH the public api.z.ai and
 * the internal gateway:
 *   1st attempt: POST {baseUrl}/videos/generations  — public form (`model`
 *                is REQUIRED there; without it the API returns a 500 NPE),
 *                with duration/size/prompt normalized to the documented
 *                public constraints (duration ∈ {5,10}, supported sizes,
 *                prompt ≤ 512 chars)
 *   fallback:    POST {baseUrl}/video/generation    — SDK/internal form
 *                (raw values — the internal gateway is permissive)
 * A 404 (route not found) triggers the fallback; any other error is thrown.
 * Within each form, a 400 that mentions "duration" advances a duration
 * candidate ladder (normalized → 5 → omit) so unsupported values
 * self-heal instead of hard-failing.
 */
async function createVideoCompat(
  body: {
    prompt?: string;
    size?: string;
    duration?: number;
    quality?: string;
    with_audio?: boolean;
    image_url?: string | string[];
  },
  timeoutMs: number
): Promise<VideoTaskCreateResult> {
  const cfg = await getEndpointConfig();
  const model = process.env.ZAI_VIDEO_MODEL || DEFAULT_VIDEO_MODEL;
  const durationCandidates = videoDurationCandidates(body.duration);

  const forms: {
    url: string;
    build: (d: number | undefined) => unknown;
  }[] = [
    {
      url: `${cfg.baseUrl}/videos/generations`,
      // Public form: model required + normalized constraints
      build: (d) => ({
        ...body,
        ...(body.prompt ? { prompt: body.prompt.slice(0, 500) } : {}),
        ...(body.size ? { size: normalizeVideoSizeForPublic(body.size) } : {}),
        ...(d !== undefined ? { duration: d } : {}),
        model,
      }),
    },
    {
      url: `${cfg.baseUrl}/video/generation`,
      // Internal/SDK form: raw values, no model
      build: (d) => ({ ...body, ...(d !== undefined ? { duration: d } : {}) }),
    },
  ];

  let lastError: ZAIError | null = null;
  for (let f = 0; f < forms.length; f++) {
    const form = forms[f];
    const isLastForm = f === forms.length - 1;
    for (let c = 0; c < durationCandidates.length; c++) {
      const duration = durationCandidates[c];
      const isLastCandidate = c === durationCandidates.length - 1;
      let res: ZaiRequestResult;
      try {
        res = await zaiRequest(
          form.url,
          { method: "POST", bodyJson: form.build(duration) },
          timeoutMs
        );
      } catch (err) {
        // Network/timeout error — try the other endpoint form
        const classified = err instanceof ZAIError ? err : classifyError(err);
        if (isLastForm && isLastCandidate) throw classified;
        lastError = classified;
        break;
      }
      if (res.status === 404) {
        // Route not found on this infrastructure — try the other form.
        lastError = new ZAIError(
          `Video create endpoint not available (404) at ${form.url}`,
          "validation",
          { status: 404 }
        );
        break;
      }
      if (res.status >= 400) {
        const apiMsg = extractApiErrorMessage(res.body);
        const err = new ZAIError(
          apiMsg
            ? `API request failed with status ${res.status}: ${apiMsg}`
            : `API request failed with status ${res.status}`,
          statusToErrorKind(res.status),
          { status: res.status, cause: res.body }
        );
        // "The current duration value is not supported" → next candidate
        if (/duration/i.test(apiMsg ?? "") && !isLastCandidate) {
          lastError = err;
          continue;
        }
        throw err;
      }
      assertNoBodyError(res.body, "video generation create");
      // Success — remember which duration worked and warn if we adjusted
      lastGoodVideoDuration = duration === undefined ? "omit" : duration;
      if (body.duration !== undefined && duration !== body.duration) {
        console.warn(
          `[ZAI] Video duration ${body.duration}s adjusted to ${duration ?? "API default"}s (API supports 5s/10s only)`
        );
      }
      return res.body as VideoTaskCreateResult;
    }
  }
  throw lastError ?? new ZAIError("createVideoCompat exhausted attempts", "unknown");
}

/**
 * Query an async task result, working on BOTH infrastructures:
 *   1st attempt: GET {baseUrl}/async-result/{taskId}   — public form (path param)
 *   fallback:    GET {baseUrl}/async-result?id={taskId} — internal/SDK form
 * A 404 (route not found) triggers the fallback. A missing/expired task
 * surfaces as a 400 + error code 1233 ("Task ... does not exist") and is
 * thrown immediately without falling back.
 */
async function queryAsyncResultCompat(
  taskId: string,
  timeoutMs = 30_000
): Promise<AsyncResultResponse> {
  const cfg = await getEndpointConfig();
  const id = encodeURIComponent(taskId);
  const attempts: string[] = [
    `${cfg.baseUrl}/async-result/${id}`, // public api.z.ai (path param)
    `${cfg.baseUrl}/async-result?id=${id}`, // internal gateway (query param)
  ];

  let lastError: ZAIError | null = null;
  for (let i = 0; i < attempts.length; i++) {
    const url = attempts[i];
    const isLast = i === attempts.length - 1;
    let res: ZaiRequestResult;
    try {
      res = await zaiRequest(url, { method: "GET" }, timeoutMs);
    } catch (err) {
      const classified = err instanceof ZAIError ? err : classifyError(err);
      if (isLast) throw classified;
      lastError = classified;
      continue;
    }
    if (res.status === 404) {
      // Route not found on this infrastructure — try the other form.
      lastError = new ZAIError(
        `Async result endpoint not available (404) at ${url}`,
        "validation",
        { status: 404 }
      );
      if (!isLast) continue;
      throw lastError;
    }
    if (res.status >= 400) {
      const apiMsg = extractApiErrorMessage(res.body);
      throw new ZAIError(
        apiMsg
          ? `API request failed with status ${res.status}: ${apiMsg}`
          : `API request failed with status ${res.status}`,
        statusToErrorKind(res.status),
        { status: res.status, cause: res.body }
      );
    }
    // HTTP 200 but error body (internal gateway reports "task does not
    // exist" as code 1233 in a 200/4xx body) — fail fast, no retry.
    const bodyObj = (res.body ?? {}) as Record<string, unknown>;
    const errObj =
      bodyObj.error && typeof bodyObj.error === "object"
        ? (bodyObj.error as Record<string, unknown>)
        : null;
    if (errObj && String(errObj.code) === "1233") {
      throw new ZAIError(
        String(errObj.message ?? `Task ${taskId} does not exist`),
        "validation",
        { status: res.status, cause: res.body }
      );
    }
    assertNoBodyError(res.body, "async result query");
    return res.body as AsyncResultResponse;
  }
  throw lastError ?? new ZAIError("queryAsyncResultCompat exhausted attempts", "unknown");
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
    // Default model: use SystemConfig if available, else glm-4-plus.
    // Always specify a model so the API returns a clear error.
    model: opts.model ?? (process.env.ZAI_CHAT_MODEL || "glm-4-plus"),
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

/** Vision (multimodal) chat completion. Uses ZAI_VISION_MODEL env or falls back to default chat model. */
export async function vision(opts: VisionOptions): Promise<string> {
  const zai = await getClient();
  const body: CreateChatCompletionVisionBody = {
    model: opts.model || process.env.ZAI_VISION_MODEL || process.env.ZAI_CHAT_MODEL || "glm-4-plus",
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

// ─── Image Generation Compatibility (public API vs internal gateway) ────────
//
// The SDK posts {prompt, size} (no model) to {baseUrl}/images/generations and
// expects data[].base64 — the internal gateway's contract. The PUBLIC
// api.z.ai:
//   * REQUIRES a `model` field (glm-image | cogview-4-250304). A request
//     without it can return HTTP 200 with an error body, which crashes the
//     SDK's `result.data.map(...)` with a TypeError (this is exactly what
//     the VPS thumbnail failures showed).
//   * Returns {created, data: [{url}]} — a URL that must be downloaded.
//
// createImageCompat tries the public form first (model included, cogview-4
// sizes match the app's size maps exactly), then the SDK/internal form
// (no model). Both response shapes are normalized to base64.

const DEFAULT_IMAGE_MODEL = "cogview-4-250304";

interface ImageCompatBody {
  prompt: string;
  size?: string;
}

/** Download a generated image URL and return it as base64. */
async function downloadUrlAsBase64(url: string, timeoutMs = 60_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new ZAIError(`Failed to download generated image (status ${res.status})`, "server");
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString("base64");
  } catch (err) {
    if (err instanceof ZAIError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new ZAIError("Image download timed out", "timeout");
    }
    throw classifyError(err);
  } finally {
    clearTimeout(timer);
  }
}

/** Extract the first image from an /images/generations response body,
 *  downloading it if the API returned a URL instead of base64 content. */
async function extractImageAsBase64(body: unknown, timeoutMs: number): Promise<string> {
  const obj = body as { data?: Array<{ base64?: string; url?: string }> } | null;
  const first = obj?.data?.[0];
  if (first?.base64) return first.base64;
  if (first?.url) return downloadUrlAsBase64(first.url, timeoutMs);
  throw new ZAIError("ZAI image generation returned no image data", "server", { cause: body });
}

async function createImageCompat(
  body: ImageCompatBody,
  timeoutMs: number
): Promise<string> {
  const cfg = await getEndpointConfig();
  const model = process.env.ZAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
  const attempts: { bodyJson: unknown; label: string }[] = [
    { bodyJson: { ...body, model }, label: "POST /images/generations (public, model included)" },
    { bodyJson: { ...body }, label: "POST /images/generations (internal/SDK, no model)" },
  ];

  let lastError: ZAIError | null = null;
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    const isLast = i === attempts.length - 1;
    let res: ZaiRequestResult;
    try {
      res = await zaiRequest(
        `${cfg.baseUrl}/images/generations`,
        { method: "POST", bodyJson: attempt.bodyJson },
        timeoutMs
      );
    } catch (err) {
      const classified = err instanceof ZAIError ? err : classifyError(err);
      if (isLast) throw classified;
      lastError = classified;
      continue;
    }
    if (res.status === 404) {
      lastError = new ZAIError(
        `Image create endpoint not available (404): ${attempt.label}`,
        "validation",
        { status: 404 }
      );
      if (!isLast) continue;
      throw lastError;
    }
    if (res.status >= 400) {
      const apiMsg = extractApiErrorMessage(res.body);
      const err = new ZAIError(
        apiMsg
          ? `API request failed with status ${res.status}: ${apiMsg}`
          : `API request failed with status ${res.status}`,
        statusToErrorKind(res.status),
        { status: res.status, cause: res.body }
      );
      // Model unknown/rejected on this infrastructure → try the no-model
      // form (the internal gateway's contract).
      if (!isLast && (err.kind === "validation" || /model/i.test(apiMsg ?? ""))) {
        console.warn(`[ZAI] Image generation with model failed (${err.message}) — retrying without model`);
        lastError = err;
        continue;
      }
      throw err;
    }
    // HTTP 200 — but the public API can wrap errors as {code, message}, and
    // a wrong-form request can return a body with no usable data array.
    try {
      assertNoBodyError(res.body, "image generation");
      return await extractImageAsBase64(res.body, timeoutMs);
    } catch (err) {
      if (
        !isLast &&
        err instanceof ZAIError &&
        (err.kind === "validation" || err.kind === "server")
      ) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new ZAIError("createImageCompat exhausted attempts", "unknown");
}

/** Generate an image, returning the base64 string of the first result.
 *
 *  Goes through createImageCompat so it works on BOTH the public api.z.ai
 *  (model required, data[].url responses that get downloaded) and the
 *  internal gateway (no model, data[].base64 responses).
 */
export async function generateImage(opts: ImageOptions): Promise<string> {
  const body: ImageCompatBody = {
    prompt: opts.prompt,
    size: opts.size ?? "1024x1024",
  };

  return withRetry(
    (signal) =>
      Promise.race([
        createImageCompat(body, 120_000),
        new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => reject(new ZAIError("Image generation timed out", "timeout")), {
            once: true,
          });
        }),
      ]),
    { label: "ZAI image generation", timeoutMs: 120_000, maxRetries: 4, ...opts.retry }
  );
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

/** Kick off a video generation task. Returns the task ID for polling.
 *
 * Video generation is expensive and has long rate-limit cooldowns (minutes),
 * so we do NOT retry rate_limit errors — they'd just burn through the
 * retry window. Instead, we fail immediately so the caller can decide
 * whether to wait and retry later.
 */
export async function generateVideo(opts: VideoOptions): Promise<string> {
  const body = {
    prompt: opts.prompt,
    size: opts.size,
    duration: opts.duration,
    quality: opts.quality ?? "quality",
    with_audio: opts.withAudio ?? true,
    ...(opts.imageUrl ? { image_url: opts.imageUrl } : {}),
  };

  const maxRetries = opts.retry?.maxRetries ?? 4;
  const timeoutMs = opts.retry?.timeoutMs ?? 120_000;

  try {
    // createVideoCompat tries the PUBLIC endpoint form first
    // (POST /videos/generations with `model`) and falls back to the
    // SDK/internal form (POST /video/generation) on 404. It handles its
    // own AbortController timeout internally.
    const res = await withRetry(
      async () => createVideoCompat(body, timeoutMs),
      { label: "ZAI video generation", timeoutMs, maxRetries, ...opts.retry }
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
  } catch (err) {
    // If the last error is a rate_limit, re-throw without wrapping so
    // the caller gets the clean ZAIError with kind=rate_limit.
    if (err instanceof ZAIError && err.kind === "rate_limit") {
      throw err;
    }
    throw err;
  }
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
      // queryAsyncResultCompat tries the PUBLIC endpoint form first
      // (GET /async-result/{taskId}) and falls back to the SDK/internal
      // form (GET /async-result?id=...) on 404.
      const res: AsyncResultResponse = await queryAsyncResultCompat(opts.taskId);

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
    // Z.ai API only accepts "wav" (default), "pcm". Sending "mp3" returns
    // error 1214 "不支持当前response_format值" (unsupported response_format).
    response_format: opts.responseFormat ?? "wav",
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
