import {
  getAIProviderSettings,
  synthesizeProviderSpeech,
  type AIProviderSettings,
  type TextProviderId,
} from "../src/lib/ai-provider-router-qwen";
import { getConfigValue } from "../src/lib/secure-config";
import { zai } from "../src/lib/zai";
import { getZaiTtsSettings, ttsWithRequiredModel } from "../src/lib/zai-tts-compat";

const TIMEOUT_MS = 60_000;
const ZAI_PREFLIGHT_ATTEMPTS = 3;

function effectiveTextModel(
  provider: TextProviderId,
  settings: AIProviderSettings,
  includeActiveOverride: boolean,
): string {
  if (includeActiveOverride && settings.textModel) return settings.textModel;
  if (provider === "xai") return settings.xaiTextModel;
  if (provider === "compatible") return settings.compatibleTextModel;
  return process.env.ZAI_CHAT_MODEL?.trim() || "glm-4.5-flash";
}

async function fetchWithTimeout(url: string, init: RequestInit, label: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${label} timed out after ${TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
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
    return `${response.status}: ${text.slice(0, 240)}`;
  }
}

async function probeOpenAICompatibleText(opts: {
  provider: "xai" | "compatible";
  baseUrl: string;
  apiKey: string;
  model: string;
}): Promise<void> {
  const label = opts.provider === "xai" ? "xAI" : "OpenAI-compatible provider";
  if (!opts.apiKey) throw new Error(`${label} API key is not configured`);
  if (!opts.baseUrl) throw new Error(`${label} base URL is not configured`);
  if (!opts.model) throw new Error(`${label} text model is not configured`);
  if (!/^https:\/\//i.test(opts.baseUrl)) throw new Error(`${label} base URL must use HTTPS`);

  const response = await fetchWithTimeout(
    `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: "system", content: "You are a deployment health check. Reply with exactly OK." },
          { role: "user", content: "ping" },
        ],
        temperature: 0,
        max_tokens: 4,
      }),
    },
    `${label} text probe`,
  );

  if (!response.ok) {
    throw new Error(`${label} model ${opts.model} failed: ${await responseError(response)}`);
  }
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  const choices = body && Array.isArray(body.choices) ? body.choices : [];
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = first?.message && typeof first.message === "object"
    ? first.message as Record<string, unknown>
    : null;
  if (!message || typeof message.content !== "string" || !message.content.trim()) {
    throw new Error(`${label} model ${opts.model} returned no completion content`);
  }
}

async function probeTextProvider(
  provider: TextProviderId,
  settings: AIProviderSettings,
  includeActiveOverride: boolean,
): Promise<void> {
  const model = effectiveTextModel(provider, settings, includeActiveOverride);
  if (provider === "zai") {
    await zai.chat({
      model,
      systemPrompt: "You are a deployment health check. Reply with exactly OK.",
      userPrompt: "ping",
      thinking: "disabled",
      extra: { temperature: 0, max_tokens: 4 },
      retry: {
        label: "Production routed Z.ai text preflight",
        maxRetries: ZAI_PREFLIGHT_ATTEMPTS,
        timeoutMs: TIMEOUT_MS,
      },
    });
    console.log(`[provider-preflight] text ${provider}/${model}: OK`);
    return;
  }

  if (provider === "xai") {
    await probeOpenAICompatibleText({
      provider,
      baseUrl: settings.xaiBaseUrl,
      apiKey: await getConfigValue("xai_api_key", "XAI_API_KEY"),
      model,
    });
    console.log(`[provider-preflight] text ${provider}/${model}: OK`);
    return;
  }

  await probeOpenAICompatibleText({
    provider,
    baseUrl: settings.compatibleBaseUrl,
    apiKey: await getConfigValue("compatible_api_key", "AI_COMPATIBLE_API_KEY"),
    model,
  });
  console.log(`[provider-preflight] text ${provider}/${model}: OK`);
}

async function probeElevenLabs(settings: AIProviderSettings): Promise<void> {
  const apiKey = await getConfigValue("elevenlabs_api_key", "ELEVENLABS_API_KEY");
  if (!apiKey) throw new Error("ElevenLabs is selected but ELEVENLABS_API_KEY is not configured");

  const baseUrl = settings.elevenLabsBaseUrl.replace(/\/+$/, "");
  const model = settings.ttsModel || "eleven_v3";
  const modelsResponse = await fetchWithTimeout(
    `${baseUrl}/models`,
    { headers: { "xi-api-key": apiKey, Accept: "application/json" } },
    "ElevenLabs model probe",
  );
  if (!modelsResponse.ok) {
    throw new Error(`ElevenLabs model discovery failed: ${await responseError(modelsResponse)}`);
  }
  const modelsBody = await modelsResponse.json().catch(() => null) as unknown;
  const models = Array.isArray(modelsBody)
    ? modelsBody
    : modelsBody && typeof modelsBody === "object" && Array.isArray((modelsBody as Record<string, unknown>).models)
      ? (modelsBody as Record<string, unknown>).models as unknown[]
      : [];
  const modelExists = models.some((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    return row.model_id === model || row.id === model;
  });
  if (!modelExists) throw new Error(`ElevenLabs TTS model ${model} is not available to the configured API key`);

  const defaultVoice = settings.elevenLabsDefaultVoiceId.trim();
  if (!defaultVoice) {
    throw new Error("ElevenLabs is selected but elevenlabs_default_voice_id is empty; group/narrator dialogue would fail");
  }

  const voiceIds = [...new Set([
    defaultVoice,
    ...Object.values(settings.elevenLabsVoiceMap).map((voice) => voice.trim()).filter(Boolean),
  ])];
  for (const voiceId of voiceIds) {
    const response = await fetchWithTimeout(
      `${baseUrl}/voices/${encodeURIComponent(voiceId)}`,
      { headers: { "xi-api-key": apiKey, Accept: "application/json" } },
      `ElevenLabs voice ${voiceId} probe`,
    );
    if (!response.ok) {
      throw new Error(`ElevenLabs voice ${voiceId} is not usable: ${await responseError(response)}`);
    }
  }

  console.log(`[provider-preflight] TTS elevenlabs/${model}: OK (${voiceIds.length} voice${voiceIds.length === 1 ? "" : "s"} verified)`);
}

async function probeZaiTts(): Promise<void> {
  const settings = await getZaiTtsSettings();
  const audio = await ttsWithRequiredModel({
    input: "OK",
    voice: "tongtong",
    responseFormat: "wav",
    retry: {
      label: "Production routed Z.ai TTS preflight",
      timeoutMs: TIMEOUT_MS,
      maxRetries: ZAI_PREFLIGHT_ATTEMPTS,
    },
  });
  if (audio.byteLength <= 0) throw new Error("Z.AI GLM-TTS preflight returned empty audio");
  console.log(`[provider-preflight] TTS zai/${settings.model}: OK`);
}

async function probeQwenTts(): Promise<void> {
  const result = await synthesizeProviderSpeech({
    input: "Vidora OK.",
    voice: "tongtong",
    language: "en",
    speed: 1,
  });
  if (result.provider !== "qwen") {
    throw new Error(`Qwen3-TTS preflight resolved unexpected provider ${result.provider}`);
  }
  if (result.buffer.length <= 0) throw new Error("Qwen3-TTS preflight returned empty audio");
  console.log(`[provider-preflight] TTS qwen/${result.model}/${result.voice}: OK`);
}

async function main(): Promise<void> {
  try {
    const settings = await getAIProviderSettings();
    await probeTextProvider(settings.textProvider, settings, true);

    if (settings.textFallbackProvider !== "none" && settings.textFallbackProvider !== settings.textProvider) {
      // The global ai_text_model is an active-route override. A different
      // fallback provider intentionally uses its own provider-specific model.
      await probeTextProvider(settings.textFallbackProvider, settings, false);
    }

    if (settings.ttsProvider === "elevenlabs") {
      await probeElevenLabs(settings);
    } else if (settings.ttsProvider === "qwen") {
      // Exercise the exact non-realtime Qwen3-TTS path, including the temporary
      // audio URL download. This catches wrong-region keys, unavailable voices,
      // model mistakes, and expired/misconfigured DashScope credentials before
      // a production release is marked healthy.
      await probeQwenTts();
    } else {
      // GLM-TTS lives on a dedicated BigModel speech endpoint and can use a
      // distinct credential from the api.z.ai chat/image/video client. Probe
      // the exact runtime route so missing credentials or stale model config
      // fail deployment before users encounter them in Voice Studio/export.
      await probeZaiTts();
    }

    console.log("AI provider routing live preflight: OK");
  } catch (error) {
    console.error(
      "FATAL: AI provider routing live preflight failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    process.exitCode = 1;
  }
}

void main();