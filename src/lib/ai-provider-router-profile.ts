import { getConfigValue } from "@/lib/secure-config";
import * as baseProvider from "./ai-provider-router";
import type {
  AIProviderSettings,
  ProviderSpeechOptions,
  ProviderSpeechResult,
} from "./ai-provider-router";
import { getVoiceSynthesisContext } from "@/lib/voice-profile-context";
import {
  DEFAULT_VOICE_PROFILE,
  styleDelivery,
  type VoiceProfile,
} from "@/lib/voice-profile";

export * from "./ai-provider-router";

const ZAI_LOGICAL_VOICES = new Set([
  "tongtong", "chuichui", "xiaochen", "jam", "kazi", "douji", "luodo",
]);
const ELEVEN_V3_RE = /^eleven_v3(?:$|[-_:])/i;

function normalizeLogicalVoice(requested: string | undefined, profile: VoiceProfile): string {
  const profileVoiceRaw = profile.voice?.trim();
  const profileVoiceKey = profileVoiceRaw?.toLowerCase();
  if (profileVoiceKey && profileVoiceKey !== "auto") {
    // Vidora logical voice names are normalized; provider-native IDs retain
    // exact casing because some providers treat IDs as case-sensitive.
    return ZAI_LOGICAL_VOICES.has(profileVoiceKey) ? profileVoiceKey : profileVoiceRaw;
  }

  const requestedRaw = requested?.trim();
  const requestedKey = requestedRaw?.toLowerCase();
  if (profile.accent === "gb" && (!requestedKey || requestedKey === "tongtong")) return "jam";
  if (!requestedRaw) return "tongtong";
  return requestedKey && ZAI_LOGICAL_VOICES.has(requestedKey) ? requestedKey : requestedRaw;
}

function effectiveProfile(requestedVoice?: string): VoiceProfile {
  const context = getVoiceSynthesisContext();
  if (!context) return DEFAULT_VOICE_PROFILE;
  const key = requestedVoice?.trim().toLowerCase() || "";
  return (key && context.byVoice[key]) || context.sceneProfile;
}

export function elevenLabsProfileVoiceCandidates(
  requested: string | undefined,
  profile: VoiceProfile,
): string[] {
  const voice = normalizeLogicalVoice(requested, profile);
  const voiceKey = voice.toLowerCase();
  const language = profile.language || "auto";
  const accent = profile.accent || "auto";
  return [
    `profile:${language}:${accent}:${voiceKey}`,
    `profile:${language}:${accent}`,
    `accent:${language}:${accent}`,
    `accent:${accent}`,
    `language:${language}`,
    voiceKey,
  ].filter((value, index, all) => value && all.indexOf(value) === index);
}

export function resolveElevenLabsProfileVoice(
  requested: string | undefined,
  profile: VoiceProfile,
  settings: Pick<AIProviderSettings, "elevenLabsVoiceMap" | "elevenLabsDefaultVoiceId">,
): string {
  for (const candidate of elevenLabsProfileVoiceCandidates(requested, profile)) {
    const mapped = settings.elevenLabsVoiceMap[candidate.toLowerCase()];
    if (mapped) return mapped;
  }
  const voice = normalizeLogicalVoice(requested, profile);
  const voiceKey = voice.toLowerCase();
  if (voiceKey && !ZAI_LOGICAL_VOICES.has(voiceKey) && voiceKey !== "auto") return voice;
  if (settings.elevenLabsDefaultVoiceId) return settings.elevenLabsDefaultVoiceId;
  throw new Error(
    "ElevenLabs is selected but no matching/default voice is configured. Add an accent/language mapping or set elevenlabs_default_voice_id.",
  );
}

/**
 * ElevenLabs' `language_code` field is ISO 639-1. Most Vidora dubbing codes
 * follow that convention, but `ga` is intentionally Vidora's Ghanaian Ga
 * language code while ISO 639-1 `ga` means Irish. Never send that collision
 * to the provider. Three-letter internal codes (for example `twi`/`dag`) are
 * also left to text auto-detection rather than sending an invalid override.
 */
export function elevenLabsLanguageCode(language: string): string | null {
  const normalized = language.trim().toLowerCase();
  if (!normalized || normalized === "auto" || normalized === "ga") return null;
  return /^[a-z]{2}$/.test(normalized) ? normalized : null;
}

function combinedDirection(request: ProviderSpeechOptions, profile: VoiceProfile): string | null {
  if (request.direction?.trim()) return request.direction.trim();
  return styleDelivery(profile.style).direction;
}

function effectiveSpeed(request: ProviderSpeechOptions, profile: VoiceProfile): number {
  const profileSpeed = Math.abs(profile.speed - 1) > 0.001 ? profile.speed : (request.speed ?? 1);
  return Math.max(0.7, Math.min(1.2, profileSpeed * styleDelivery(profile.style).speedFactor));
}

async function elevenLabsProfileSpeech(
  request: ProviderSpeechOptions,
  settings: AIProviderSettings,
  profile: VoiceProfile,
): Promise<ProviderSpeechResult> {
  const apiKey = await getConfigValue("elevenlabs_api_key", "ELEVENLABS_API_KEY");
  if (!apiKey) throw new Error("ElevenLabs API key is not configured");

  const voice = resolveElevenLabsProfileVoice(request.voice, profile, settings);
  const model = settings.ttsModel || "eleven_v3";
  const isV3 = ELEVEN_V3_RE.test(model);
  const direction = combinedDirection(request, profile);
  const text = baseProvider.formatElevenLabsPerformanceText(request.input, direction, model);
  const delivery = styleDelivery(profile.style);
  const languageCode = elevenLabsLanguageCode(profile.language);

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
          text,
          model_id: model,
          // ElevenLabs can force language on supported models. Accent is
          // intentionally selected through an accent-trained voice mapping.
          ...(!/multilingual_v2/i.test(model) && languageCode ? { language_code: languageCode } : {}),
          voice_settings: {
            stability: isV3 ? 0.5 : 0.48,
            similarity_boost: 0.78,
            style: isV3 ? 0 : delivery.expression,
            use_speaker_boost: true,
            speed: effectiveSpeed(request, profile),
          },
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      const textBody = await response.text();
      throw new Error(`ElevenLabs TTS failed (HTTP ${response.status}): ${textBody.slice(0, 400)}`);
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
  const profile = effectiveProfile(request.voice);
  const settings = await baseProvider.getAIProviderSettings();

  if (settings.ttsProvider === "elevenlabs") {
    return elevenLabsProfileSpeech(request, settings, profile);
  }

  // Z.AI naturally follows the language of the input text. Its current adapter
  // has no separate accent/style parameters, so we apply the selected logical
  // voice plus delivery speed without pretending unsupported accent precision.
  return baseProvider.synthesizeProviderSpeech({
    ...request,
    voice: normalizeLogicalVoice(request.voice, profile).toLowerCase(),
    direction: combinedDirection(request, profile),
    speed: effectiveSpeed(request, profile),
  });
}
