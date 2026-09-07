import {
  generateProviderText,
  getAIProviderSettings as getBaseAIProviderSettings,
  synthesizeProviderSpeech as synthesizeBaseProviderSpeech,
  type AIProviderSettings as BaseAIProviderSettings,
  type ProviderSpeechOptions,
  type ProviderSpeechResult as BaseProviderSpeechResult,
  type TextProviderId,
  type TtsProviderId as BaseTtsProviderId,
} from "./ai-provider-router";
import { getConfigValue } from "@/lib/secure-config";
import { synthesizeQwenTts } from "@/lib/qwen-tts";
import { synthesizeGrokTts } from "@/lib/grok-tts";

export * from "./ai-provider-router";

export type TtsProviderId = BaseTtsProviderId | "qwen" | "grok";
export type AIProviderSettings = Omit<BaseAIProviderSettings, "ttsProvider"> & {
  ttsProvider: TtsProviderId;
};
export type ProviderSpeechResult = Omit<BaseProviderSpeechResult, "provider"> & {
  provider: TtsProviderId;
};

export async function getAIProviderSettings(): Promise<AIProviderSettings> {
  const base = await getBaseAIProviderSettings();
  const configured = (await getConfigValue("ai_tts_provider")).trim().toLowerCase();
  return {
    ...base,
    ttsProvider: configured === "qwen" || configured === "grok"
      ? configured
      : base.ttsProvider,
  };
}

export async function synthesizeProviderSpeech(
  request: ProviderSpeechOptions,
): Promise<ProviderSpeechResult> {
  const settings = await getAIProviderSettings();
  if (settings.ttsProvider === "qwen") {
    return synthesizeQwenTts({
      input: request.input,
      voice: request.voice,
      speed: request.speed,
      language: request.language,
      accent: request.accent,
      direction: request.direction,
      model: settings.ttsModel,
    });
  }
  if (settings.ttsProvider === "grok") {
    return synthesizeGrokTts({
      input: request.input,
      voice: request.voice,
      speed: request.speed,
      language: request.language,
      accent: request.accent,
      direction: request.direction,
      model: settings.ttsModel,
    });
  }
  return synthesizeBaseProviderSpeech(request);
}

export { generateProviderText };
export type { ProviderSpeechOptions, TextProviderId };
