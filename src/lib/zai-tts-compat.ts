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
  const model = opts.model?.trim() || configuredModel.trim() || "glm-tts";
  const client = await getClient();

  const body = {
    model,
    input: opts.input,
    voice: opts.voice ?? "tongtong",
    response_format: opts.responseFormat ?? "wav",
    speed: opts.speed ?? 1,
    stream: false,
  };

  const response = await withRetry(
    (signal) =>
      Promise.race([
        // The installed SDK's TypeScript declaration predates the required
        // `model` field, but the transport serializes the supplied JSON body.
        client.audio.tts.create(body as never),
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
