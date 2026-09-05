import { getConfigValue } from "@/lib/secure-config";
import { zai } from "@/lib/zai";

export type TextProviderId = "zai" | "xai" | "compatible";
export type TtsProviderId = "zai" | "elevenlabs";

export interface AIProviderSettings {
  textProvider: TextProviderId;
  textModel: string;
  textFallbackProvider: TextProviderId | "none";
  ttsProvider: TtsProviderId;
  ttsModel: string;
  xaiBaseUrl: string;
  xaiTextModel: string;
  elevenLabsBaseUrl: string;
  elevenLabsDefaultVoiceId: string;
  elevenLabsVoiceMap: Record<string, string>;
  compatibleBaseUrl: string;
  compatibleTextModel: string;
}

export interface ProviderTextOptions {
  systemPrompt?: string;
  userPrompt: string;
  model?: string;
  thinking?: "enabled" | "disabled";
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface ProviderSpeechOptions {
  input: string;
  voice?: string;
  speed?: number;
}

export interface ProviderSpeechResult {
  buffer: Buffer;
  extension: "wav" | "mp3";
  provider: TtsProviderId;
  model: string;
  voice: string;
}

const TEXT_PROVIDERS = new Set<TextProviderId>(["zai", "xai", "compatible"]);
const TTS_PROVIDERS = new Set<TtsProviderId>(["zai", "elevenlabs"]);
const ZAI_LOGICAL_VOICES = new Set([
  "tongtong",
  "chuichui",
  "xiaochen",
  "jam",
  "kazi",
  "douji",
  "luodo",
]);

function normalizeBaseUrl(value: string, fallback: string): string {
  const base = (value || fallback).trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(base)) {
    throw new Error(`AI provider base URL must use HTTPS: ${base || "(empty)"}`);
  }
  return base;
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

function asTextProvider(value: string, fallback: TextProviderId): TextProviderId {
  const normalized = value.trim().toLowerCase() as TextProviderId;
  return TEXT_PROVIDERS.has(normalized) ? normalized : fallback;
}

function asTtsProvider(value: string, fallback: TtsProviderId): TtsProviderId {
  const normalized = value.trim().toLowerCase() as TtsProviderId;
  return TTS_PROVIDERS.has(normalized) ? normalized : fallback;
}

export async function getAIProviderSettings(): Promise<AIProviderSettings> {
  const [
    textProviderRaw,
    textModel,
    textFallbackRaw,
    ttsProviderRaw,
    ttsModel,
    xaiBaseUrl,
    xaiTextModel,
    elevenLabsBaseUrl,
    elevenLabsDefaultVoiceId,
    elevenLabsVoiceMap,
    compatibleBaseUrl,
    compatibleTextModel,
  ] = await Promise.all([
    getConfigValue("ai_text_provider"),
    getConfigValue("ai_text_model"),
    getConfigValue("ai_text_fallback_provider"),
    getConfigValue("ai_tts_provider"),
    getConfigValue("ai_tts_model"),
    getConfigValue("xai_base_url"),
    getConfigValue("xai_text_model"),
    getConfigValue("elevenlabs_base_url"),
    getConfigValue("elevenlabs_default_voice_id"),
    getConfigValue("elevenlabs_voice_map"),
    getConfigValue("compatible_base_url"),
    getConfigValue("compatible_text_model"),
  ]);

  const fallback = textFallbackRaw.trim().toLowerCase();
  return {
    textProvider: asTextProvider(textProviderRaw, "zai"),
    textModel: textModel.trim(),
    textFallbackProvider: fallback === "none" || !fallback
      ? "none"
      : asTextProvider(fallback, "zai"),
    ttsProvider: asTtsProvider(ttsProviderRaw, "zai"),
    ttsModel: ttsModel.trim(),
    xaiBaseUrl: normalizeBaseUrl(xaiBaseUrl, "https://api.x.ai/v1"),
    xaiTextModel: xaiTextModel.trim() || "grok-4.6",
    elevenLabsBaseUrl: normalizeBaseUrl(elevenLabsBaseUrl, "https://api.elevenlabs.io/v1"),
    elevenLabsDefaultVoiceId: elevenLabsDefaultVoiceId.trim(),
    elevenLabsVoiceMap: parseVoiceMap(elevenLabsVoiceMap),
    compatibleBaseUrl: compatibleBaseUrl.trim(),
    compatibleTextModel: compatibleTextModel.trim(),
  };
}

async function readJsonResponse(response: Response, providerLabel: string): Promise<Record<string, unknown>> {
  const text = await response.text();
  let body: Record<string, unknown> = {};
  if (text) {
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      if (!response.ok) throw new Error(`${providerLabel} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
      throw new Error(`${providerLabel} returned a non-JSON response`);
    }
  }
  if (!response.ok) {
    const nested = body.error && typeof body.error === "object"
      ? body.error as Record<string, unknown>
      : null;
    const message = String(nested?.message || body.message || body.error || `HTTP ${response.status}`);
    throw new Error(`${providerLabel} request failed: ${message}`);
  }
  return body;
}

async function openAICompatibleChat(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  providerLabel: string;
  request: ProviderTextOptions;
}): Promise<string> {
  if (!opts.apiKey) throw new Error(`${opts.providerLabel} API key is not configured`);
  if (!opts.model) throw new Error(`${opts.providerLabel} text model is not configured`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.request.timeoutMs ?? 90_000);
  try {
    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (opts.request.systemPrompt) messages.push({ role: "system", content: opts.request.systemPrompt });
    messages.push({ role: "user", content: opts.request.userPrompt });

    const response = await fetch(`${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        messages,
        temperature: opts.request.temperature ?? 0.45,
        max_tokens: opts.request.maxTokens ?? 4_000,
        ...(opts.providerLabel === "xAI" && opts.request.thinking === "enabled"
          ? { reasoning_effort: "high" }
          : {}),
      }),
      signal: controller.signal,
    });
    const body = await readJsonResponse(response, opts.providerLabel);
    const choices = Array.isArray(body.choices) ? body.choices : [];
    const first = choices[0] as Record<string, unknown> | undefined;
    const message = first?.message && typeof first.message === "object"
      ? first.message as Record<string, unknown>
      : null;
    const content = typeof message?.content === "string" ? message.content.trim() : "";
    if (!content) throw new Error(`${opts.providerLabel} returned an empty text completion`);
    return content;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${opts.providerLabel} text request timed out`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function runTextProvider(
  provider: TextProviderId,
  request: ProviderTextOptions,
  settings: AIProviderSettings,
): Promise<string> {
  if (provider === "zai") {
    return zai.chat({
      systemPrompt: request.systemPrompt,
      userPrompt: request.userPrompt,
      model: request.model || settings.textModel || process.env.ZAI_CHAT_MODEL || undefined,
      thinking: request.thinking ?? "disabled",
      extra: {
        temperature: request.temperature ?? 0.45,
        max_tokens: request.maxTokens ?? 4_000,
      },
      retry: {
        label: "Provider-routed Z.ai text",
        timeoutMs: request.timeoutMs ?? 90_000,
        maxRetries: 3,
      },
    });
  }

  if (provider === "xai") {
    const apiKey = await getConfigValue("xai_api_key", "XAI_API_KEY");
    return openAICompatibleChat({
      baseUrl: settings.xaiBaseUrl,
      apiKey,
      model: request.model || settings.textModel || settings.xaiTextModel,
      providerLabel: "xAI",
      request,
    });
  }

  const apiKey = await getConfigValue("compatible_api_key", "AI_COMPATIBLE_API_KEY");
  if (!settings.compatibleBaseUrl) {
    throw new Error("OpenAI-compatible base URL is not configured");
  }
  return openAICompatibleChat({
    baseUrl: normalizeBaseUrl(settings.compatibleBaseUrl, settings.compatibleBaseUrl),
    apiKey,
    model: request.model || settings.textModel || settings.compatibleTextModel,
    providerLabel: "OpenAI-compatible provider",
    request,
  });
}

export async function generateProviderText(request: ProviderTextOptions): Promise<string> {
  const settings = await getAIProviderSettings();
  try {
    return await runTextProvider(settings.textProvider, request, settings);
  } catch (primaryError) {
    const fallback = settings.textFallbackProvider;
    if (fallback === "none" || fallback === settings.textProvider) throw primaryError;
    console.warn(
      `[ai-provider] text provider ${settings.textProvider} failed; trying fallback ${fallback}:`,
      primaryError instanceof Error ? primaryError.message : "unknown error",
    );
    return runTextProvider(fallback, request, settings);
  }
}

function resolveElevenLabsVoice(
  requested: string | undefined,
  settings: AIProviderSettings,
): string {
  const logical = (requested || "").trim().toLowerCase();
  const mapped = logical ? settings.elevenLabsVoiceMap[logical] : "";
  if (mapped) return mapped;
  if (requested && !ZAI_LOGICAL_VOICES.has(logical)) return requested.trim();
  if (settings.elevenLabsDefaultVoiceId) return settings.elevenLabsDefaultVoiceId;
  throw new Error(
    "ElevenLabs is selected but no default voice ID is configured. Set elevenlabs_default_voice_id or add the logical voice to elevenlabs_voice_map.",
  );
}

async function elevenLabsSpeech(
  request: ProviderSpeechOptions,
  settings: AIProviderSettings,
): Promise<ProviderSpeechResult> {
  const apiKey = await getConfigValue("elevenlabs_api_key", "ELEVENLABS_API_KEY");
  if (!apiKey) throw new Error("ElevenLabs API key is not configured");
  const voice = resolveElevenLabsVoice(request.voice, settings);
  const model = settings.ttsModel || "eleven_v3";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(
      `${settings.elevenLabsBaseUrl}/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: request.input,
          model_id: model,
          voice_settings: {
            stability: 0.42,
            similarity_boost: 0.78,
            style: 0.55,
            use_speaker_boost: true,
            speed: Math.max(0.7, Math.min(1.2, request.speed ?? 1)),
          },
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ElevenLabs TTS failed (HTTP ${response.status}): ${text.slice(0, 400)}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error("ElevenLabs returned empty audio");
    return { buffer, extension: "mp3", provider: "elevenlabs", model, voice };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("ElevenLabs TTS timed out");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function synthesizeProviderSpeech(
  request: ProviderSpeechOptions,
): Promise<ProviderSpeechResult> {
  const settings = await getAIProviderSettings();
  if (settings.ttsProvider === "elevenlabs") {
    return elevenLabsSpeech(request, settings);
  }

  const voice = (request.voice || "tongtong").trim().toLowerCase();
  const audio = await zai.tts({
    input: request.input,
    voice,
    speed: request.speed ?? 1,
    responseFormat: "wav",
    retry: { label: "Provider-routed Z.ai TTS", timeoutMs: 120_000, maxRetries: 4 },
  });
  return {
    buffer: Buffer.from(new Uint8Array(audio)),
    extension: "wav",
    provider: "zai",
    model: settings.ttsModel || "zai-tts",
    voice,
  };
}

export function buildProfessionalSceneDirectorPrompt(opts: {
  source: string;
  targetDuration: number;
  projectType?: string;
}): { systemPrompt: string; userPrompt: string } {
  const sceneCount = Math.max(1, Math.min(12, Math.ceil(opts.targetDuration / 10)));
  const systemPrompt = `You are Vidora's senior story editor, dialogue director, and video pre-production planner.
Your job is to turn a user's idea into a shoot-ready scene plan with explicit spoken lines.

NON-NEGOTIABLE QUALITY RULES:
1. Preserve every important proper name, age, relationship, event, date, product, place, and factual detail from the user's request. Never silently substitute a name.
2. Spoken intent must become explicit dialogue. Do NOT assume the video generator will invent speech correctly.
3. If the request is a birthday/celebration, naturally say the honoree's name in spoken dialogue. Include a clear greeting such as "Happy birthday, <name>!" when appropriate to the user's request.
4. Give named characters their own short, natural lines. Avoid one generic narrator speaking for everybody when character dialogue is appropriate.
5. Keep each 10-second scene speakable: normally 1-3 short utterances, with enough time for acting and reactions.
6. Dialogue must advance the story and match what the viewer sees. Avoid filler.
7. Visual directions must never contain dialogue labels. Spoken lines must always use Speaker: text.
8. Do not add copyrighted song lyrics. If music is requested, describe mood/instrumentation only.
9. Maintain character continuity, visual identity, location continuity, and emotional progression across scenes.
10. End with a satisfying payoff/CTA/greeting appropriate to the user's intent.

OUTPUT FORMAT ONLY — no markdown fences and no commentary:
Scene 1 - Short title
Visual: precise cinematic visual direction
Speaker Name: exact spoken line
Another Speaker: exact spoken line

Repeat for exactly ${sceneCount} scenes. Every scene must contain a Visual: line. Use Narrator: only when narration genuinely improves clarity.`;

  const userPrompt = `Project type: ${opts.projectType || "custom"}
Target duration: ${opts.targetDuration} seconds (${sceneCount} scenes at about 10 seconds each)

USER'S ORIGINAL REQUEST — preserve its facts and names:
${opts.source}`;
  return { systemPrompt, userPrompt };
}
