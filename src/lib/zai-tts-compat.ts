import { getConfigValue } from "@/lib/secure-config";
import {
  ZAIError,
  withRetry,
  zai as baseZai,
  type TTSOptions,
} from "./zai";

export * from "./zai";

export const DEFAULT_ZAI_TTS_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
export const DEFAULT_ZAI_TTS_MODEL = "glm-tts";

export interface ModelAwareTTSOptions extends TTSOptions {
  /** Explicit GLM speech model. Falls back to the documented glm-tts model. */
  model?: string;
}

export interface ZaiTtsSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * Z.AI/BigModel currently documents glm-tts as the speech model for this
 * endpoint. `ai_tts_model` is shared with other TTS providers, so a stale value
 * such as `eleven_v3` or the legacy Vidora label `zai-tts` must never leak into
 * a GLM-TTS request after switching providers. An explicit model supplied by a
 * reviewed caller is still honored so future model rollouts can be tested
 * deliberately without changing the global configuration first.
 */
export function resolveZaiTtsModel(explicitModel?: string, configuredModel?: string): string {
  const explicit = explicitModel?.trim();
  if (explicit) return explicit;

  const configured = configuredModel?.trim().toLowerCase();
  return configured === DEFAULT_ZAI_TTS_MODEL
    ? DEFAULT_ZAI_TTS_MODEL
    : DEFAULT_ZAI_TTS_MODEL;
}

export function resolveZaiTtsBaseUrl(configuredBaseUrl?: string): string {
  const value = configuredBaseUrl?.trim() || DEFAULT_ZAI_TTS_BASE_URL;
  return value.replace(/\/+$/, "");
}

export function buildZaiTtsSpeechEndpoint(baseUrl: string): string {
  const normalized = resolveZaiTtsBaseUrl(baseUrl);
  return normalized.endsWith("/audio/speech") ? normalized : `${normalized}/audio/speech`;
}

export async function getZaiTtsSettings(explicitModel?: string): Promise<ZaiTtsSettings> {
  const [configuredBaseUrl, apiKey, configuredModel] = await Promise.all([
    getConfigValue("zai_tts_base_url", "ZAI_TTS_BASE_URL"),
    getConfigValue("zai_tts_api_key", "ZAI_TTS_API_KEY"),
    getConfigValue("ai_tts_model", "ZAI_TTS_MODEL"),
  ]);

  if (!apiKey) {
    throw new ZAIError(
      "Dedicated Z.AI/BigModel TTS credentials are not configured. Set zai_tts_api_key in Admin Providers or ZAI_TTS_API_KEY for the GLM-TTS endpoint.",
      "auth",
    );
  }

  const model = resolveZaiTtsModel(explicitModel, configuredModel);
  const configured = configuredModel?.trim();
  if (
    !explicitModel?.trim() &&
    configured &&
    configured.toLowerCase() !== DEFAULT_ZAI_TTS_MODEL
  ) {
    console.warn(
      `[ZAI] Ignoring stale ai_tts_model "${configured}" for Z.AI speech; using ${DEFAULT_ZAI_TTS_MODEL}`,
    );
  }

  return {
    baseUrl: resolveZaiTtsBaseUrl(configuredBaseUrl),
    apiKey,
    model,
  };
}

/**
 * GLM-TTS uses the BigModel speech endpoint, which is separate from Vidora's
 * global api.z.ai client used for chat/image/video. Keeping this transport
 * independent prevents a working video/chat configuration from being changed
 * merely to make speech synthesis available.
 */
export async function ttsWithRequiredModel(opts: ModelAwareTTSOptions): Promise<ArrayBuffer> {
  const settings = await getZaiTtsSettings(opts.model);
  const endpoint = buildZaiTtsSpeechEndpoint(settings.baseUrl);

  const response = await withRetry<Response>(
    async (signal) => {
      const result = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.apiKey}`,
          "Content-Type": "application/json",
          Accept: "audio/wav,application/octet-stream,*/*;q=0.8",
        },
        body: JSON.stringify({
          model: settings.model,
          input: opts.input,
          voice: opts.voice ?? "tongtong",
          response_format: opts.responseFormat ?? "wav",
          speed: opts.speed ?? 1,
          stream: false,
        }),
        signal,
        cache: "no-store",
      });

      if (!result.ok) {
        const errorBody = (await result.text()).slice(0, 1200);
        throw new Error(`API request failed with status ${result.status}: ${errorBody}`);
      }
      return result;
    },
    {
      label: opts.retry?.label || "ZAI GLM-TTS",
      timeoutMs: opts.retry?.timeoutMs ?? 120_000,
      maxRetries: opts.retry?.maxRetries ?? 4,
      baseDelayMs: opts.retry?.baseDelayMs,
      maxDelayMs: opts.retry?.maxDelayMs,
    },
  );

  const audio = await response.arrayBuffer();
  if (audio.byteLength > 0) return audio;
  throw new ZAIError("ZAI GLM-TTS returned an empty audio response", "server");
}

/**
 * Drop-in namespace used by the existing application. All Z.AI helpers remain
 * on the global api.z.ai client except TTS, which uses its dedicated BigModel
 * endpoint and credential.
 */
export const zai = {
  ...baseZai,
  tts: ttsWithRequiredModel,
};

export default zai;
