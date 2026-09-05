import { describe, expect, test } from "bun:test";
import {
  DEFAULT_VOICE_PROFILE,
  INHERIT_VOICE_PROFILE,
  mergeVoiceProfiles,
  sanitizeVoiceProfile,
  styleDelivery,
} from "../../src/lib/voice-profile";
import {
  elevenLabsProfileVoiceCandidates,
  resolveElevenLabsProfileVoice,
} from "../../src/lib/ai-provider-router-profile";

describe("voice profiles", () => {
  test("sanitizes language accent style and speed", () => {
    expect(sanitizeVoiceProfile({
      language: "EN",
      accent: "GH",
      voice: "JAM",
      style: "DOCUMENTARY",
      speed: 9,
    })).toEqual({
      language: "en",
      accent: "gh",
      voice: "jam",
      style: "documentary",
      speed: 1.3,
    });
  });

  test("preserves provider-native voice ID casing", () => {
    expect(sanitizeVoiceProfile({ voice: "AbCDef123VoiceID" }).voice).toBe("AbCDef123VoiceID");
  });

  test("scene and character auto values inherit project defaults", () => {
    const project = {
      ...DEFAULT_VOICE_PROFILE,
      language: "en",
      accent: "gh",
      voice: "kazi",
      style: "warm" as const,
      speed: 1.1,
    };
    expect(mergeVoiceProfiles(project, INHERIT_VOICE_PROFILE)).toEqual(project);
  });

  test("explicit character fields override inherited values independently", () => {
    const project = {
      ...DEFAULT_VOICE_PROFILE,
      language: "en",
      accent: "gh",
      voice: "kazi",
      style: "warm" as const,
      speed: 1.05,
    };
    expect(mergeVoiceProfiles(project, {
      ...INHERIT_VOICE_PROFILE,
      accent: "gb",
      voice: "jam",
      speed: 0.9,
    })).toEqual({
      language: "en",
      accent: "gb",
      voice: "jam",
      style: "warm",
      speed: 0.9,
    });
  });

  test("speaking styles materially change delivery", () => {
    expect(styleDelivery("energetic")).toEqual({
      direction: "excited",
      speedFactor: 1.08,
      expression: 0.48,
    });
    expect(styleDelivery("calm").speedFactor).toBeLessThan(1);
  });
});

describe("ElevenLabs accent-aware voice routing", () => {
  const profile = {
    language: "en",
    accent: "gh",
    voice: "kazi",
    style: "natural" as const,
    speed: 1,
  };

  test("prefers the most specific language/accent/logical-voice mapping", () => {
    expect(elevenLabsProfileVoiceCandidates("kazi", profile)[0]).toBe("profile:en:gh:kazi");
    expect(resolveElevenLabsProfileVoice("kazi", profile, {
      elevenLabsDefaultVoiceId: "default-provider-voice",
      elevenLabsVoiceMap: {
        "profile:en:gh:kazi": "ghana-kazi-provider-voice",
        kazi: "generic-kazi-provider-voice",
      },
    })).toBe("ghana-kazi-provider-voice");
  });

  test("keeps direct provider voice ID casing when no map is needed", () => {
    expect(resolveElevenLabsProfileVoice(undefined, {
      ...profile,
      voice: "AbCDef123VoiceID",
    }, {
      elevenLabsDefaultVoiceId: "default-provider-voice",
      elevenLabsVoiceMap: {},
    })).toBe("AbCDef123VoiceID");
  });

  test("falls back to the configured provider default", () => {
    expect(resolveElevenLabsProfileVoice("kazi", profile, {
      elevenLabsDefaultVoiceId: "default-provider-voice",
      elevenLabsVoiceMap: {},
    })).toBe("default-provider-voice");
  });
});
