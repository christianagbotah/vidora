import {
  DEFAULT_NARRATION_PROFILE,
  normalizeNarrationProfile,
} from "@/lib/narration-profile";
import { DEFAULT_TTS_VOICE, TTS_VOICES } from "@/lib/narration";

export interface VoiceStudioProfile {
  language: string;
  accent: string;
  style: string;
  voice: string;
}

export interface VoiceStudioMixedState {
  language: boolean;
  accent: boolean;
  style: boolean;
  voice: boolean;
}

export interface VoiceStudioSceneProfileSource {
  narrationLang?: string | null;
  narrationAccent?: string | null;
  narrationStyle?: string | null;
  narrationVoice?: string | null;
}

const LOGICAL_VOICE_IDS = new Set(TTS_VOICES.map((voice) => voice.id));

export const DEFAULT_VOICE_STUDIO_PROFILE: VoiceStudioProfile = {
  ...DEFAULT_NARRATION_PROFILE,
  voice: DEFAULT_TTS_VOICE,
};

export function normalizeVoiceStudioVoice(value?: unknown): string {
  const requested = typeof value === "string" ? value.trim().toLowerCase() : "";
  return LOGICAL_VOICE_IDS.has(requested) ? requested : DEFAULT_TTS_VOICE;
}

export function normalizeVoiceStudioProfile(value?: unknown): VoiceStudioProfile {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const narration = normalizeNarrationProfile({
    language: typeof input.language === "string" ? input.language : undefined,
    accent: typeof input.accent === "string" ? input.accent : undefined,
    style: typeof input.style === "string" ? input.style : undefined,
  });
  return {
    ...narration,
    voice: normalizeVoiceStudioVoice(input.voice),
  };
}

export function voiceStudioProfileForScene(scene: VoiceStudioSceneProfileSource): VoiceStudioProfile {
  return normalizeVoiceStudioProfile({
    language: scene.narrationLang || undefined,
    accent: scene.narrationAccent || undefined,
    style: scene.narrationStyle || undefined,
    voice: scene.narrationVoice || undefined,
  });
}

export function summarizeVoiceStudioScenes(scenes: VoiceStudioSceneProfileSource[]): {
  profile: VoiceStudioProfile;
  mixed: VoiceStudioMixedState;
} {
  if (scenes.length === 0) {
    return {
      profile: DEFAULT_VOICE_STUDIO_PROFILE,
      mixed: { language: false, accent: false, style: false, voice: false },
    };
  }

  const profiles = scenes.map(voiceStudioProfileForScene);
  const first = profiles[0];
  return {
    profile: first,
    mixed: {
      language: profiles.some((profile) => profile.language !== first.language),
      accent: profiles.some((profile) => profile.accent !== first.accent),
      style: profiles.some((profile) => profile.style !== first.style),
      voice: profiles.some((profile) => profile.voice !== first.voice),
    },
  };
}

export function parseVoiceStudioCharacterIds(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}
