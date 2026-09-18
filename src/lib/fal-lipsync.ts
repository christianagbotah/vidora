const FAL_QUEUE_BASE_URL = "https://queue.fal.run";
export const FAL_TALKING_PHOTO_MODEL = "fal-ai/sync-lipsync/v3/image-to-video";
export const FAL_TALKING_PHOTO_OPERATION = "lip_sync" as const;

export type FalQueueStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED" | string;

export interface FalTalkingPhotoSubmitResult {
  requestId: string;
  statusUrl?: string | null;
  responseUrl?: string | null;
  cancelUrl?: string | null;
}

export interface FalTalkingPhotoStatus {
  status: FalQueueStatus;
  queuePosition?: number | null;
  logs?: Array<{ message?: string | null }> | null;
  raw: Record<string, unknown>;
}

export interface FalTalkingPhotoResult {
  requestId: string;
  videoUrl: string;
  raw: Record<string, unknown>;
}

export class FalProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "FalProviderError";
  }
}

function requireFalKey(): string {
  const value = (process.env.FAL_KEY || "").trim();
  if (!value) {
    throw new FalProviderError(
      "FAL_KEY_MISSING",
      "Talking Photo provider is not configured.",
    );
  }
  return value;
}

export function isFalTalkingPhotoConfigured(): boolean {
  return Boolean((process.env.FAL_KEY || "").trim());
}

export function assertFalTalkingPhotoConfigured(): void {
  requireFalKey();
}

function assertHttpsUrl(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new FalProviderError("FAL_INPUT_URL_INVALID", `${label} URL is invalid.`);
  }
  if (parsed.protocol !== "https:") {
    throw new FalProviderError(
      "FAL_INPUT_URL_UNSAFE",
      `${label} URL must use HTTPS so the provider can fetch it safely.`,
    );
  }
  return parsed.toString();
}

async function falFetchJson(
  url: string,
  init: RequestInit,
  timeoutMs = 30_000,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Key ${requireFalKey()}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers || {}),
      },
      cache: "no-store",
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const detail = typeof body.detail === "string"
        ? body.detail
        : typeof body.error === "string"
          ? body.error
          : `fal request failed with HTTP ${response.status}`;
      throw new FalProviderError("FAL_PROVIDER_REQUEST_FAILED", detail, response.status);
    }
    return body;
  } catch (error) {
    if (error instanceof FalProviderError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new FalProviderError("FAL_PROVIDER_TIMEOUT", "fal request timed out.");
    }
    throw new FalProviderError(
      "FAL_PROVIDER_UNAVAILABLE",
      error instanceof Error ? error.message : "fal provider request failed.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

function requestPath(requestId: string): string {
  const safe = requestId.trim();
  if (!safe || !/^[A-Za-z0-9_-]+$/.test(safe)) {
    throw new FalProviderError("FAL_REQUEST_ID_INVALID", "fal request id is invalid.");
  }
  return `${FAL_QUEUE_BASE_URL}/${FAL_TALKING_PHOTO_MODEL}/requests/${encodeURIComponent(safe)}`;
}

export async function submitFalTalkingPhoto(input: {
  imageUrl: string;
  audioUrl: string;
}): Promise<FalTalkingPhotoSubmitResult> {
  const imageUrl = assertHttpsUrl(input.imageUrl, "Image");
  const audioUrl = assertHttpsUrl(input.audioUrl, "Audio");
  const body = await falFetchJson(
    `${FAL_QUEUE_BASE_URL}/${FAL_TALKING_PHOTO_MODEL}`,
    {
      method: "POST",
      body: JSON.stringify({
        image_url: imageUrl,
        audio_url: audioUrl,
      }),
    },
    45_000,
  );

  const requestId = typeof body.request_id === "string"
    ? body.request_id
    : typeof body.requestId === "string"
      ? body.requestId
      : "";
  if (!requestId) {
    throw new FalProviderError(
      "FAL_PROVIDER_RESPONSE_INVALID",
      "fal accepted the request but did not return a request id.",
    );
  }
  return {
    requestId,
    statusUrl: typeof body.status_url === "string" ? body.status_url : null,
    responseUrl: typeof body.response_url === "string" ? body.response_url : null,
    cancelUrl: typeof body.cancel_url === "string" ? body.cancel_url : null,
  };
}

export async function getFalTalkingPhotoStatus(
  requestId: string,
): Promise<FalTalkingPhotoStatus> {
  const body = await falFetchJson(
    `${requestPath(requestId)}/status`,
    { method: "GET" },
  );
  return {
    status: typeof body.status === "string" ? body.status : "UNKNOWN",
    queuePosition: typeof body.queue_position === "number" ? body.queue_position : null,
    logs: Array.isArray(body.logs)
      ? body.logs.filter((entry): entry is { message?: string | null } =>
          Boolean(entry) && typeof entry === "object")
      : null,
    raw: body,
  };
}

export async function getFalTalkingPhotoResult(
  requestId: string,
): Promise<FalTalkingPhotoResult> {
  const body = await falFetchJson(requestPath(requestId), { method: "GET" });
  const video = body.video;
  const videoUrl = video && typeof video === "object" && typeof (video as { url?: unknown }).url === "string"
    ? (video as { url: string }).url
    : "";
  if (!videoUrl) {
    throw new FalProviderError(
      "FAL_PROVIDER_RESULT_INVALID",
      "fal completed the request without returning a video URL.",
    );
  }
  return { requestId, videoUrl, raw: body };
}
