import { getConfigValue } from "@/lib/secure-config";
import {
  ZAIError,
  getClient,
  withRetry,
  zai as baseZai,
  type TTSOptions,
} from "./zai";

export * from "./zai";

export interface ModelAwareTTSOptions extends TTSOptions {
  /** Explicit Z.AI speech model. Falls back to configured ai_tts_model/ZAI_TTS_MODEL/glm-tts. */
  model?: string;
}

export function resolveZaiTtsModel(explicitModel?: string, configuredModel?: string): string {
  return explicitModel?.trim() || configuredModel?.trim() || "glm-tts";
}

type SpeechTransportResponse = {
  arrayBuffer(): Promise<ArrayBuffer>;
};

type SpeechTransport = (body: Record<string, unknown>) => Promise<SpeechTransportResponse>;

/**
 * Compatibility adapter for the current Z.AI speech endpoint.
 *
 * z-ai-web-dev-sdk@0.0.x exposes a TTS request shape without `model`, while the
 * production /audio/speech API requires one. Keep the SDK client/retry/error
 * handling, but submit the model-aware request body directly through its TTS
 * transport so preview and export narration cannot fail with an empty model.
 */
export async function ttsWithRequiredModel(opts: ModelAwareTTSOptions): Promise<ArrayBuffer> {
  const configuredModel = await getConfigValue("ai_tts_model", "ZAI_TTS_MODEL");
  const model = resolveZaiTtsModel(opts.model, configuredModel);
  const client = await getClient();

  const body: Record<string, unknown> = {
    model,
    input: opts.input,
    voice: opts.voice ?? "tongtong",
    response_format: opts.responseFormat ?? "wav",
    speed: opts.speed ?? 1,
    stream: false,
  };

  // The installed SDK's declaration predates the provider-required `model`
  // field. Narrow just this transport boundary instead of weakening types in
  // the rest of the Z.AI wrapper.
  const createSpeech = client.audio.tts.create as unknown as SpeechTransport;

  const response = await withRetry<SpeechTransportResponse>(
    (signal) =>
      Promise.race([
        createSpeech(body),
        new Promise<never>((_, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new ZAIError("TTS timed out", "timeout")),
            { once: true },
          );
        }),
      ]),
    {
      label: opts.retry?.label || "ZAI TTS (model-aware)",
      timeoutMs: opts.retry?.timeoutMs ?? 120_000,
      maxRetries: opts.retry?.maxRetries ?? 4,
      baseDelayMs: opts.retry?.baseDelayMs,
      maxDelayMs: opts.retry?.maxDelayMs,
    },
  );

  if (response && typeof response.arrayBuffer === "function") {
    return response.arrayBuffer();
  }

  throw new ZAIError("ZAI TTS returned an unexpected response shape", "server");
}

/**
 * Drop-in namespace used by the existing application. All Z.AI helpers remain
 * untouched except TTS, which now includes the provider-required model code.
 */
export const zai = {
  ...baseZai,
  tts: ttsWithRequiredModel,
};

export default zai;
