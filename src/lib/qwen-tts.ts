import { execFile } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { promisify } from "util";
import { getConfigValue } from "@/lib/secure-config";

export const DEFAULT_QWEN_TTS_BASE_URL = "https://dashscope-intl.aliyuncs.com/api/v1";
export const DEFAULT_QWEN_TTS_MODEL = "qwen3-tts-instruct-flash";
export const DEFAULT_QWEN_TTS_VOICE = "Cherry";
const QWEN_TTS_MAX_CHARS = 600;
const QWEN_TTS_SAFE_CHARS = 560;
const execFileAsync = promisify(execFile);

const QWEN_INSTRUCT_VOICES = [
  "Cherry",
  "Serena",
  "Ethan",
  "Chelsie",
  "Momo",
  "Vivian",
  "Moon",
  "Maia",
  "Kai",
  "Nofish",
  "Bella",
  "Eldric Sage",
  "Mia",
  "Mochi",
  "Bellona",
  "Vincent",
  "Bunny",
  "Neil",
  "Elias",
  "Arthur",
  "Nini",
  "Seren",
  "Pip",
  "Stella",
] as const;

const QWEN_INSTRUCT_VOICE_BY_LOWER = new Map(
  QWEN_INSTRUCT_VOICES.map((voice) => [voice.toLowerCase(), voice]),
);

const QWEN_INSTRUCT_LEGACY_REMAP: Record<string, string> = {
  ryan: "Bellona",
  jennifer: "Maia",
  katerina: "Maia",
  aiden: "Mochi",
  bodega: "Vincent",
  sonrisa: "Bella",
};

const QWEN_INSTRUCT_LOGICAL_FALLBACK: Record<string, string> = {
  tongtong: "Cherry",
  chuichui: "Pip",
  luodo: "Bellona",
  kazi: "Ethan",
  douji: "Serena",
  xiaochen: "Neil",
  jam: "Eldric Sage",
};

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

interface DownloadedAudio {
  buffer: Buffer;
  extension: "wav" | "mp3";
}

interface SynthesizedAudio extends DownloadedAudio {
  voice: string;
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

/**
 * The old qwen3-tts-flash model remains accepted as legacy configuration, but
 * Vidora deliberately upgrades it to the instruction-capable stable model so
 * screenplay performance direction is not silently ignored.
 */
export function resolveQwenTtsModel(explicitModel?: string | null): string {
  const candidate = (explicitModel || "").trim();
  if (/^qwen3-tts-instruct-flash(?:$|-\d{4}-\d{2}-\d{2}$)/i.test(candidate)) {
    return candidate;
  }
  if (/^qwen3-tts-flash(?:$|-\d{4}-\d{2}-\d{2}$)/i.test(candidate)) {
    return DEFAULT_QWEN_TTS_MODEL;
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

/**
 * Keep each provider request comfortably below Qwen3-TTS' 600-character
 * non-realtime limit. Prefer sentence/word boundaries, but hard-split when a
 * legacy scene contains one unusually long token or sentence.
 */
export function splitQwenTtsInput(text: string, maxLen = QWEN_TTS_SAFE_CHARS): string[] {
  const normalized = text.trim();
  if (!normalized) return [];
  const limit = Math.max(1, Math.min(QWEN_TTS_MAX_CHARS, Math.floor(maxLen)));
  if (normalized.length <= limit) return [normalized];

  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > limit) {
    const window = remaining.slice(0, limit + 1);
    const candidates = [
      window.lastIndexOf("。"),
      window.lastIndexOf("！"),
      window.lastIndexOf("？"),
      window.lastIndexOf("."),
      window.lastIndexOf("!"),
      window.lastIndexOf("?"),
      window.lastIndexOf(";"),
      window.lastIndexOf(","),
      window.lastIndexOf(" "),
      window.lastIndexOf("\n"),
    ];
    const boundary = Math.max(...candidates);
    const cut = boundary >= Math.floor(limit * 0.45) ? boundary + 1 : limit;
    const chunk = remaining.slice(0, cut).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.trim()) chunks.push(remaining.trim());
  return chunks;
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

function canonicalInstructVoice(value: string | null | undefined): string | null {
  return QWEN_INSTRUCT_VOICE_BY_LOWER.get((value || "").trim().toLowerCase()) || null;
}

/**
 * qwen3-tts-instruct-flash does not share the complete system-voice roster of
 * qwen3-tts-flash. Preserve valid/current voices, translate known legacy
 * Flash-only voices to close Instruct equivalents, and leave unknown values
 * untouched so newly-added provider voices can still be attempted. A provider
 * rejection is handled by a second safe attempt below.
 */
export function resolveQwenVoiceForModel(
  resolvedVoice: string,
  requestedVoice: string | undefined,
  model: string,
  defaultVoice: string,
): string {
  if (!/^qwen3-tts-instruct-flash/i.test(model)) return resolvedVoice;

  const canonical = canonicalInstructVoice(resolvedVoice);
  if (canonical) return canonical;

  const legacy = QWEN_INSTRUCT_LEGACY_REMAP[resolvedVoice.trim().toLowerCase()];
  if (legacy) return legacy;

  const logical = QWEN_INSTRUCT_LOGICAL_FALLBACK[(requestedVoice || "").trim().toLowerCase()];
  if (logical && !resolvedVoice.trim()) return logical;

  const safeDefault = canonicalInstructVoice(defaultVoice) || DEFAULT_QWEN_TTS_VOICE;
  return resolvedVoice.trim() || safeDefault;
}

export function qwenInstructFallbackVoice(
  requestedVoice: string | undefined,
  defaultVoice: string,
): string {
  const logical = QWEN_INSTRUCT_LOGICAL_FALLBACK[(requestedVoice || "").trim().toLowerCase()];
  if (logical) return logical;
  return canonicalInstructVoice(defaultVoice) || DEFAULT_QWEN_TTS_VOICE;
}

function buildEndpoint(baseUrl: string): string {
  const normalized = (baseUrl || DEFAULT_QWEN_TTS_BASE_URL).trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(normalized)) {
    throw new Error("Qwen3-TTS base URL must use HTTPS");
  }
  const suffix = "/services/aigc/multimodal-generation/generation";
  return normalized.endsWith(suffix) ? normalized : `${normalized}${suffix}`;
}

export async function isQwenTtsConfigured(): Promise<boolean> {
  return Boolean(await getConfigValue("qwen_tts_api_key", "DASHSCOPE_API_KEY"));
}

export async function assertQwenTtsConfigured(): Promise<void> {
  if (!(await isQwenTtsConfigured())) {
    throw new Error(
      "Qwen3-TTS API key is not configured. Set qwen_tts_api_key in Admin Providers or DASHSCOPE_API_KEY on the server.",
    );
  }
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

export function qwenPerformanceInstruction(request: QwenTtsRequest): string | null {
  const parts: string[] = [];
  if (request.direction?.trim()) parts.push(`Perform the line ${request.direction.trim()}.`);
  const speed = Number(request.speed);
  if (Number.isFinite(speed) && speed > 0 && Math.abs(speed - 1) >= 0.08) {
    parts.push(speed < 1 ? "Speak at a slower pace." : "Speak at a faster pace.");
  }
  if (request.accent?.trim() && request.accent.trim().toLowerCase() !== "auto") {
    parts.push(`Use a natural ${request.accent.trim()} accent when appropriate for the selected language.`);
  }
  return parts.join(" ").trim() || "Deliver the line naturally with expressive, cinematic speech.";
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

function isUnsupportedVoiceError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /voice\s+['\"].+['\"]\s+is\s+not\s+supported/i.test(error.message)
    || /invalidparameter.*voice/i.test(error.message);
}

async function downloadAudio(url: string): Promise<DownloadedAudio> {
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

async function synthesizeOneAttempt(opts: {
  text: string;
  settings: QwenTtsSettings;
  model: string;
  voice: string;
  languageType: string;
  instruction: string;
}): Promise<SynthesizedAudio> {
  if (opts.text.length > QWEN_TTS_MAX_CHARS) {
    throw new Error(`Qwen3-TTS internal chunk exceeds the ${QWEN_TTS_MAX_CHARS}-character API limit`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(buildEndpoint(opts.settings.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.settings.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        input: {
          text: opts.text,
          voice: opts.voice,
          language_type: opts.languageType,
          instructions: opts.instruction,
          optimize_instructions: true,
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
    return { ...(await downloadAudio(audioUrl)), voice: opts.voice };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Qwen3-TTS synthesis timed out");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function synthesizeOne(opts: {
  text: string;
  settings: QwenTtsSettings;
  model: string;
  voice: string;
  fallbackVoice: string;
  languageType: string;
  instruction: string;
}): Promise<SynthesizedAudio> {
  try {
    return await synthesizeOneAttempt(opts);
  } catch (error) {
    if (
      /^qwen3-tts-instruct-flash/i.test(opts.model)
      && opts.voice.toLowerCase() !== opts.fallbackVoice.toLowerCase()
      && isUnsupportedVoiceError(error)
    ) {
      console.warn(
        `[Qwen3-TTS] Voice ${JSON.stringify(opts.voice)} is unavailable for ${opts.model}; retrying with ${JSON.stringify(opts.fallbackVoice)}`,
      );
      return synthesizeOneAttempt({ ...opts, voice: opts.fallbackVoice });
    }
    throw error;
  }
}

function ffmpegPathLiteral(value: string): string {
  return value.replace(/'/g, "'\\''");
}

async function concatenateQwenAudio(parts: DownloadedAudio[]): Promise<Buffer> {
  if (parts.length === 1) return parts[0].buffer;

  const workDir = await mkdtemp(path.join(tmpdir(), "vidora-qwen-tts-"));
  const listPath = path.join(workDir, "concat.txt");
  const outputPath = path.join(workDir, "combined.wav");
  try {
    const partPaths: string[] = [];
    for (let index = 0; index < parts.length; index += 1) {
      const partPath = path.join(workDir, `part-${String(index).padStart(3, "0")}.${parts[index].extension}`);
      await writeFile(partPath, parts[index].buffer);
      partPaths.push(partPath);
    }
    await writeFile(
      listPath,
      partPaths.map((partPath) => `file '${ffmpegPathLiteral(partPath)}'`).join("\n"),
      "utf8",
    );
    await execFileAsync(
      "ffmpeg",
      [
        "-nostdin", "-y", "-f", "concat", "-safe", "0", "-i", listPath,
        "-vn", "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", outputPath,
      ],
      { timeout: 90_000 },
    );
    const combined = await readFile(outputPath);
    if (!combined.length) throw new Error("Qwen3-TTS audio concatenation returned an empty file");
    return combined;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function synthesizeQwenTts(request: QwenTtsRequest): Promise<QwenTtsResult> {
  const text = request.input.trim();
  if (!text) throw new Error("Qwen3-TTS requires non-empty text");

  const settings = await getSettings();
  const model = resolveQwenTtsModel(request.model);
  const mappedVoice = resolveQwenVoice(request.voice, settings, {
    language: request.language,
    accent: request.accent,
  });
  const voice = resolveQwenVoiceForModel(mappedVoice, request.voice, model, settings.defaultVoice);
  const fallbackVoice = qwenInstructFallbackVoice(request.voice, settings.defaultVoice);
  const languageType = qwenLanguageType(request.language);
  const instruction = qwenPerformanceInstruction(request)
    || "Deliver the line naturally with expressive, cinematic speech.";
  const textParts = splitQwenTtsInput(text);
  const audioParts: SynthesizedAudio[] = [];
  for (const part of textParts) {
    audioParts.push(await synthesizeOne({
      text: part,
      settings,
      model,
      voice,
      fallbackVoice,
      languageType,
      instruction,
    }));
  }

  const usedVoice = audioParts[0]?.voice || voice;
  if (audioParts.length === 1) {
    return {
      buffer: audioParts[0].buffer,
      extension: audioParts[0].extension,
      provider: "qwen",
      model,
      voice: usedVoice,
    };
  }

  return {
    buffer: await concatenateQwenAudio(audioParts),
    extension: "wav",
    provider: "qwen",
    model,
    voice: usedVoice,
  };
}
