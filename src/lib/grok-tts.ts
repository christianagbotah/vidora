import crypto from "crypto";
import { getConfigValue } from "@/lib/secure-config";

export const DEFAULT_GROK_TTS_BASE_URL = "https://api.x.ai/v1";
export const DEFAULT_GROK_TTS_MODEL = "grok-tts";
export const DEFAULT_GROK_TTS_VOICE = "orion";
const GROK_TTS_MAX_CHARS = 15_000;
const VOICE_CACHE_TTL_MS = 10 * 60 * 1000;

const VIDORA_LOGICAL_VOICES = new Set([
  "tongtong",
  "chuichui",
  "xiaochen",
  "jam",
  "kazi",
  "douji",
  "luodo",
]);

/**
 * Provider-native preference lists mirror Vidora's logical voice archetypes.
 * Availability is checked dynamically, so a changed/limited xAI voice roster
 * falls back safely instead of hard-failing character dialogue.
 */
const GROK_VOICE_PREFERENCES: Record<string, string[]> = {
  tongtong: ["orion", "altair", "lux", "eve", "sal"],       // cinematic narrator
  chuichui: ["cosmo", "iris", "helios", "eve", "ara"],    // playful / youthful
  kazi: ["perseus", "atlas", "rex", "leo", "helix"],      // heroic / confident
  luodo: ["zagan", "helix", "kepler", "helios", "rex"],  // dramatic / expressive
  douji: ["carina", "luna", "celeste", "ara", "sal"],    // warm / gentle
  xiaochen: ["rigel", "lux", "celeste", "rex", "sal"],   // calm / professional
  jam: ["altair", "leo", "lux", "sal", "orion"],         // mature / grounded
};

export interface GrokTtsRequest {
  input: string;
  voice?: string;
  speed?: number;
  language?: string | null;
  accent?: string | null;
  direction?: string | null;
  model?: string;
}

export interface GrokTtsResult {
  buffer: Buffer;
  extension: "wav" | "mp3";
  provider: "grok";
  model: string;
  voice: string;
}

interface GrokVoice {
  voice_id: string;
  name?: string;
  language?: string;
}

interface GrokSettings {
  baseUrl: string;
  apiKey: string;
  defaultVoice: string;
  voiceMap: Record<string, string>;
}

let voiceCache: { key: string; expiresAt: number; voices: GrokVoice[] } | null = null;

function parseVoiceMap(raw: string): Record<string, string> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const output: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) {
        output[key.trim().toLowerCase()] = value.trim().toLowerCase();
      }
    }
    return output;
  } catch {
    return {};
  }
}

function normalizeBaseUrl(value: string): string {
  const normalized = (value || DEFAULT_GROK_TTS_BASE_URL).trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(normalized)) throw new Error("Grok TTS base URL must use HTTPS");
  return normalized;
}

async function getSettings(): Promise<GrokSettings> {
  const [baseUrl, dedicatedKey, sharedKey, defaultVoice, voiceMap] = await Promise.all([
    getConfigValue("grok_tts_base_url", "GROK_TTS_BASE_URL"),
    getConfigValue("xai_tts_api_key", "XAI_TTS_API_KEY"),
    getConfigValue("xai_api_key", "XAI_API_KEY"),
    getConfigValue("grok_tts_default_voice", "GROK_TTS_DEFAULT_VOICE"),
    getConfigValue("grok_tts_voice_map", "GROK_TTS_VOICE_MAP"),
  ]);
  const apiKey = dedicatedKey || sharedKey;
  if (!apiKey) {
    throw new Error(
      "Grok TTS API key is not configured. Set xai_tts_api_key in Admin Providers, XAI_TTS_API_KEY, or XAI_API_KEY on the server.",
    );
  }
  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    apiKey,
    defaultVoice: defaultVoice.trim().toLowerCase() || DEFAULT_GROK_TTS_VOICE,
    voiceMap: parseVoiceMap(voiceMap),
  };
}

export function grokLanguageCode(language?: string | null): string {
  const normalized = (language || "").trim().toLowerCase();
  const map: Record<string, string> = {
    en: "en",
    english: "en",
    fr: "fr",
    french: "fr",
    de: "de",
    german: "de",
    it: "it",
    italian: "it",
    ja: "ja",
    japanese: "ja",
    ko: "ko",
    korean: "ko",
    ru: "ru",
    russian: "ru",
    zh: "zh",
    chinese: "zh",
    hi: "hi",
    hindi: "hi",
    id: "id",
    indonesian: "id",
    tr: "tr",
    turkish: "tr",
    vi: "vi",
    vietnamese: "vi",
    bn: "bn",
    bengali: "bn",
    es: "es-ES",
    spanish: "es-ES",
    pt: "pt-PT",
    portuguese: "pt-PT",
  };
  // Vidora's `ga` is Ghanaian Ga, not Irish. Unknown/internal languages use
  // xAI auto-detection instead of being deliberately mapped to the wrong BCP-47 code.
  return map[normalized] || "auto";
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

function stableIndex(value: string, modulo: number): number {
  if (modulo <= 1) return 0;
  const digest = crypto.createHash("sha256").update(value).digest();
  return digest.readUInt32BE(0) % modulo;
}

function firstAvailable(preferences: string[], available: ReadonlySet<string>): string | null {
  return preferences.find((voice) => available.has(voice)) || null;
}

function formatDirection(text: string, direction?: string | null): string {
  const cue = (direction || "").trim().toLowerCase();
  if (!cue) return text;
  if (/whisper|hushed|secret|softly/.test(cue)) return `<whisper>${text}</whisper>`;
  if (/shout|yell|loud|furious|angry/.test(cue)) return `<loud>${text}</loud>`;
  if (/slow|gentle|calm|soothing|sad|somber/.test(cue)) return `<slow><soft>${text}</soft></slow>`;
  if (/fast|urgent|excited|energetic|enthusiastic/.test(cue)) return `<fast><build-intensity>${text}</build-intensity></fast>`;
  if (/emphasis|firm|serious|important/.test(cue)) return `<emphasis>${text}</emphasis>`;
  if (/laugh|giggle|chuckle|playful|mischievous/.test(cue)) return `[chuckle] ${text}`;
  if (/cry|tearful/.test(cue)) return `[cry] ${text}`;
  if (/sigh|tired|reluctant/.test(cue)) return `[sigh] ${text}`;
  return text;
}

async function responseError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return `HTTP ${response.status}`;
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    const nested = body.error && typeof body.error === "object"
      ? body.error as Record<string, unknown>
      : null;
    return String(nested?.message || body.message || body.error || `HTTP ${response.status}`);
  } catch {
    return `${response.status}: ${text.slice(0, 300)}`;
  }
}

async function listVoices(settings: GrokSettings): Promise<GrokVoice[]> {
  const cacheKey = crypto
    .createHash("sha256")
    .update(`${settings.baseUrl}|${settings.apiKey}`)
    .digest("hex")
    .slice(0, 16);
  if (voiceCache && voiceCache.key === cacheKey && voiceCache.expiresAt > Date.now()) {
    return voiceCache.voices;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${settings.baseUrl}/tts/voices`, {
      headers: { Authorization: `Bearer ${settings.apiKey}`, Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Grok TTS voice discovery failed: ${await responseError(response)}`);
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    const rows = body && Array.isArray(body.voices) ? body.voices : [];
    const voices = rows.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const value = row as Record<string, unknown>;
      const voiceId = typeof value.voice_id === "string" ? value.voice_id.trim().toLowerCase() : "";
      if (!voiceId) return [];
      return [{
        voice_id: voiceId,
        name: typeof value.name === "string" ? value.name : undefined,
        language: typeof value.language === "string" ? value.language : undefined,
      }];
    });
    if (!voices.length) throw new Error("Grok TTS returned no available voices");
    voiceCache = { key: cacheKey, expiresAt: Date.now() + VOICE_CACHE_TTL_MS, voices };
    return voices;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Grok TTS voice discovery timed out");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveGrokVoice(
  requested: string | undefined,
  settings: Pick<GrokSettings, "defaultVoice" | "voiceMap">,
  availableVoices: GrokVoice[],
  profile: { language?: string | null; accent?: string | null } = {},
): Promise<string> {
  for (const candidate of voiceCandidates(requested, profile)) {
    const mapped = settings.voiceMap[candidate.toLowerCase()];
    if (mapped) return mapped;
  }

  const requestedVoice = (requested || "").trim().toLowerCase();
  const availableIds = availableVoices.map((voice) => voice.voice_id);
  const availableSet = new Set(availableIds);

  if (requestedVoice && !VIDORA_LOGICAL_VOICES.has(requestedVoice)) {
    // Voice Studio can store a provider-native built-in/custom voice ID directly.
    return requestedVoice;
  }

  const configuredDefault = settings.defaultVoice || DEFAULT_GROK_TTS_VOICE;
  const narratorVoice = availableSet.has(configuredDefault)
    ? configuredDefault
    : firstAvailable(GROK_VOICE_PREFERENCES.tongtong, availableSet)
      || availableIds[0]
      || configuredDefault;
  if (!requestedVoice || requestedVoice === "tongtong") return narratorVoice;

  const preferred = firstAvailable(
    GROK_VOICE_PREFERENCES[requestedVoice] || [],
    new Set(availableIds.filter((voice) => voice !== narratorVoice)),
  );
  if (preferred) return preferred;

  const nonNarrator = availableIds.filter((voice) => voice !== narratorVoice);
  const pool = nonNarrator.length ? nonNarrator : availableIds;
  return pool[stableIndex(requestedVoice, pool.length)] || narratorVoice;
}

export async function synthesizeGrokTts(request: GrokTtsRequest): Promise<GrokTtsResult> {
  const text = request.input.trim();
  if (!text) throw new Error("Grok TTS requires non-empty text");
  if (text.length > GROK_TTS_MAX_CHARS) {
    throw new Error(`Grok TTS input exceeds the ${GROK_TTS_MAX_CHARS.toLocaleString()}-character request limit`);
  }

  const settings = await getSettings();
  const voices = await listVoices(settings);
  const voice = await resolveGrokVoice(request.voice, settings, voices, {
    language: request.language,
    accent: request.accent,
  });
  const language = grokLanguageCode(request.language);
  const speed = Math.max(0.7, Math.min(1.5, Number(request.speed) || 1));
  const spokenText = formatDirection(text, request.direction);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(`${settings.baseUrl}/tts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
        Accept: "audio/wav, application/octet-stream",
      },
      body: JSON.stringify({
        text: spokenText,
        voice_id: voice,
        language,
        speed,
        output_format: {
          codec: "wav",
          sample_rate: 44_100,
        },
        text_normalization: true,
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Grok TTS request failed: ${await responseError(response)}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error("Grok TTS returned empty audio");
    return {
      buffer,
      extension: "wav",
      provider: "grok",
      model: DEFAULT_GROK_TTS_MODEL,
      voice,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Grok TTS synthesis timed out");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
