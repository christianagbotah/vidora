import { describe, expect, test } from "bun:test";
import {
  DEFAULT_VOICE_STUDIO_PROFILE,
  normalizeVoiceStudioProfile,
  parseVoiceStudioCharacterIds,
  summarizeVoiceStudioScenes,
  voiceStudioProfileForScene,
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

  test("reports which whole-video fields are mixed without inventing a second profile store", () => {
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

  test("parses exact character ids used for narration invalidation", () => {
    expect(parseVoiceStudioCharacterIds('["char-1","char-2",7,null]')).toEqual(["char-1", "char-2"]);
    expect(parseVoiceStudioCharacterIds("not-json")).toEqual([]);
    expect(parseVoiceStudioCharacterIds(null)).toEqual([]);
  });
});
