import { describe, expect, test } from "bun:test";
import {
  DEFAULT_VOICE_STUDIO_PROFILE,
  hasVoiceStudioProjectDefaults,
  normalizeVoiceStudioProfile,
  parseVoiceStudioCharacterIds,
  summarizeVoiceStudioScenes,
  voiceStudioProfileForProject,
  voiceStudioProfileForScene,
  voiceStudioProjectDefaultsData,
} from "@/lib/voice-studio";

describe("Voice Studio profile resolution", () => {
  test("normalizes narration settings through the production profile catalog", () => {
    expect(normalizeVoiceStudioProfile({
      language: "fr",
      accent: "native",
      style: "storyteller",
      voice: "Jam",
    })).toEqual({
      language: "fr",
      accent: "native",
      style: "storyteller",
      voice: "jam",
    });

    expect(normalizeVoiceStudioProfile({
      language: "not-a-language",
      accent: "not-an-accent",
      style: "not-a-style",
      voice: "not-a-voice",
    })).toEqual(DEFAULT_VOICE_STUDIO_PROFILE);
  });

  test("maps nullable legacy scene fields onto current narration defaults", () => {
    expect(voiceStudioProfileForScene({
      narrationLang: null,
      narrationAccent: null,
      narrationStyle: null,
      narrationVoice: null,
    })).toEqual(DEFAULT_VOICE_STUDIO_PROFILE);
  });

  test("reports which scene fields are mixed", () => {
    const summary = summarizeVoiceStudioScenes([
      {
        narrationLang: "en",
        narrationAccent: "ghanaian",
        narrationStyle: "warm",
        narrationVoice: "tongtong",
      },
      {
        narrationLang: "fr",
        narrationAccent: "ghanaian",
        narrationStyle: "warm",
        narrationVoice: "jam",
      },
    ]);

    expect(summary.profile).toEqual({
      language: "en",
      accent: "ghanaian",
      style: "warm",
      voice: "tongtong",
    });
    expect(summary.mixed).toEqual({
      language: true,
      accent: false,
      style: false,
      voice: true,
    });
  });

  test("legacy projects without durable defaults preserve their existing scene-derived bulk profile", () => {
    const project = {
      narrationLang: null,
      narrationAccent: null,
      narrationStyle: null,
      narrationVoice: null,
    };
    const scenes = [{
      narrationLang: "fr",
      narrationAccent: "ghanaian",
      narrationStyle: "warm",
      narrationVoice: "jam",
    }];

    expect(hasVoiceStudioProjectDefaults(project)).toBe(false);
    expect(voiceStudioProfileForProject(project, scenes)).toEqual({
      language: "fr",
      accent: "ghanaian",
      style: "warm",
      voice: "jam",
    });
  });

  test("persisted project defaults remain authoritative even when scenes have overrides", () => {
    const project = {
      narrationLang: "en",
      narrationAccent: "ghanaian",
      narrationStyle: "warm",
      narrationVoice: "tongtong",
    };
    const scenes = [{
      narrationLang: "fr",
      narrationAccent: "native",
      narrationStyle: "storyteller",
      narrationVoice: "jam",
    }];

    expect(hasVoiceStudioProjectDefaults(project)).toBe(true);
    expect(voiceStudioProfileForProject(project, scenes)).toEqual({
      language: "en",
      accent: "ghanaian",
      style: "warm",
      voice: "tongtong",
    });
  });

  test("serializes the exact normalized profile used by future scene inheritance", () => {
    expect(voiceStudioProjectDefaultsData({
      language: "fr",
      accent: "ghanaian",
      style: "warm",
      voice: "jam",
    })).toEqual({
      narrationLang: "fr",
      narrationAccent: "ghanaian",
      narrationStyle: "warm",
      narrationVoice: "jam",
    });
  });

  test("parses exact character ids used for narration invalidation", () => {
    expect(parseVoiceStudioCharacterIds('["char-1","char-2",7,null]')).toEqual(["char-1", "char-2"]);
    expect(parseVoiceStudioCharacterIds("not-json")).toEqual([]);
    expect(parseVoiceStudioCharacterIds(null)).toEqual([]);
  });
});