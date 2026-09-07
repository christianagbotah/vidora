import { getConfigValue } from "@/lib/secure-config";

export const DEFAULT_QWEN_TTS_BASE_URL = "https://dashscope-intl.aliyuncs.com/api/v1";
export const DEFAULT_QWEN_TTS_MODEL = "qwen3-tts-flash";
export const DEFAULT_QWEN_TTS_VOICE = "Cherry";
const QWEN_TTS_MAX_CHARS = 600;

export interface QwenTtsRequest {
  input: string;
  voice?: string;
  speed?: number;
  language?: string | null;
  accent?: string | null;
  direction?: string | null;
  model?: string;
}

export interface QwenTtsResult {
  buffer: Buffer;
  extension: "wav" | "mp3";
  provider: "qwen";
  model: string;
  voice: string;
}

interface QwenTtsSettings {
  baseUrl: string;
  apiKey: string;
  defaultVoice: string;
  voiceMap: Record<string, string>;
}

function parseVoiceMap(raw: string): Record<string, string> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const output: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) {
        output[key.trim().toLowerCase()] = value.trim();
      }
    }
    return output;
  } catch {
    return {};
  }
}

export function resolveQwenTtsModel(explicitModel?: string | null): string {
  const candidate = (explicitModel || "").trim();
  if (/^qwen3-tts-(?:flash|instruct-flash)(?:$|-\d{4}-\d{2}-\d{2}$)/i.test(candidate)) {
    return candidate;
  }
  return DEFAULT_QWEN_TTS_MODEL;
}

export function qwenLanguageType(language?: string | null): string {
  const normalized = (language || "").trim().toLowerCase();
  const map: Record<string, string> = {
    zh: "Chinese",
    chinese: "Chinese",
    en: "English",
    english: "English",
    de: "German",
    german: "German",
    it: "Italian",
    italian: "Italian",
    pt: "Portuguese",
    portuguese: "Portuguese",
    es: "Spanish",
    spanish: "Spanish",
    ja: "Japanese",
    japanese: "Japanese",
    ko: "Korean",
    korean: "Korean",
    fr: "French",
    french: "French",
    ru: "Russian",
    russian: "Russian",
  };
  return map[normalized] || "Auto";
}

function voiceCandidates(
  requested: string | undefined,
  profile: { language?: string | null; accent?: string | null },
): string[] {
  const voice = (requested || "").trim().toLowerCase();
  const language = (profile.language || "en").trim().toLowerCase() || "en";
  const accent = (profile.accent || "auto").trim().toLowerCase() || "auto";
  const candidates = [
    voice ? `profile:${language}:${accent}:${voice}` : "",
    `profile:${language}:${accent}`,
    `accent:${language}:${accent}`,
    `accent:${accent}`,
    `language:${language}`,
    voice,
  ];
  return candidates.filter((value, index, all) => value && all.indexOf(value) === index);
}

export function resolveQwenVoice(
  requested: string | undefined,
  settings: Pick<QwenTtsSettings, "defaultVoice" | "voiceMap">,
  profile: { language?: string | null; accent?: string | null } = {},
): string {
  for (const candidate of voiceCandidates(requested, profile)) {
    const mapped = settings.voiceMap[candidate.toLowerCase()];
    if (mapped) return mapped;
  }
  return settings.defaultVoice || DEFAULT_QWEN_TTS_VOICE;
}

function buildEndpoint(baseUrl: string): string {
  const normalized = (baseUrl || DEFAULT_QWEN_TTS_BASE_URL).trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(normalized)) {
    throw new Error("Qwen3-TTS base URL must use HTTPS");
  }
  const suffix = "/services/aigc/multimodal-generation/generation";
  return normalized.endsWith(suffix) ? normalized : `${normalized}${suffix}`;
}

async function getSettings(): Promise<QwenTtsSettings> {
  const [baseUrl, apiKey, defaultVoice, voiceMap] = await Promise.all([
    getConfigValue("qwen_tts_base_url", "QWEN_TTS_BASE_URL"),
    getConfigValue("qwen_tts_api_key", "DASHSCOPE_API_KEY"),
    getConfigValue("qwen_tts_default_voice", "QWEN_TTS_DEFAULT_VOICE"),
    getConfigValue("qwen_tts_voice_map", "QWEN_TTS_VOICE_MAP"),
  ]);
  if (!apiKey) {
    throw new Error(
      "Qwen3-TTS API key is not configured. Set qwen_tts_api_key in Admin Providers or DASHSCOPE_API_KEY on the server.",
    );
  }
  return {
    baseUrl: baseUrl.trim() || DEFAULT_QWEN_TTS_BASE_URL,
    apiKey,
    defaultVoice: defaultVoice.trim() || DEFAULT_QWEN_TTS_VOICE,
    voiceMap: parseVoiceMap(voiceMap),
  };
}

function performanceInstruction(request: QwenTtsRequest): string | null {
  const parts: string[] = [];
  if (request.direction?.trim()) parts.push(`Delivery: ${request.direction.trim()}.`);
  const speed = Number(request.speed);
  if (Number.isFinite(speed) && speed > 0 && Math.abs(speed - 1) >= 0.08) {
    parts.push(speed < 1 ? "Speak at a slower pace." : "Speak at a faster pace.");
  }
  return parts.join(" ").trim() || null;
}

function providerError(body: unknown, status: number): Error {
  if (body && typeof body === "object") {
    const row = body as Record<string, unknown>;
    const message = String(row.message || row.code || `HTTP ${status}`);
    const requestId = row.request_id ? ` (request ${String(row.request_id)})` : "";
    return new Error(`Qwen3-TTS request failed: ${message}${requestId}`);
  }
  return new Error(`Qwen3-TTS request failed with HTTP ${status}`);
}

async function downloadAudio(url: string): Promise<{ buffer: Buffer; extension: "wav" | "mp3" }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`Qwen3-TTS audio download failed with HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error("Qwen3-TTS returned an empty audio file");
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const extension = contentType.includes("mpeg") || /\.mp3(?:\?|$)/i.test(url) ? "mp3" : "wav";
    return { buffer, extension };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Qwen3-TTS audio download timed out");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function synthesizeQwenTts(request: QwenTtsRequest): Promise<QwenTtsResult> {
  const text = request.input.trim();
  if (!text) throw new Error("Qwen3-TTS requires non-empty text");
  if (text.length > QWEN_TTS_MAX_CHARS) {
    throw new Error(`Qwen3-TTS input exceeds the ${QWEN_TTS_MAX_CHARS}-character API limit`);
  }

  const settings = await getSettings();
  const model = resolveQwenTtsModel(request.model);
  const voice = resolveQwenVoice(request.voice, settings, {
    language: request.language,
    accent: request.accent,
  });
  const languageType = qwenLanguageType(request.language);
  const instruction = /qwen3-tts-instruct-flash/i.test(model)
    ? performanceInstruction(request)
    : null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(buildEndpoint(settings.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model,
        input: {
          text,
          voice,
          language_type: languageType,
          ...(instruction ? { instructions: instruction, optimize_instructions: true } : {}),
        },
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    const providerStatus = body && typeof body.status_code === "number" ? body.status_code : response.status;
    if (!response.ok || providerStatus >= 400 || (body?.code && String(body.code).trim())) {
      throw providerError(body, providerStatus);
    }

    const output = body?.output && typeof body.output === "object"
      ? body.output as Record<string, unknown>
      : null;
    const audio = output?.audio && typeof output.audio === "object"
      ? output.audio as Record<string, unknown>
      : null;
    const audioUrl = typeof audio?.url === "string" ? audio.url : "";
    if (!audioUrl) throw new Error("Qwen3-TTS returned no complete audio URL");

    const downloaded = await downloadAudio(audioUrl);
    return {
      ...downloaded,
      provider: "qwen",
      model,
      voice,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Qwen3-TTS synthesis timed out");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
