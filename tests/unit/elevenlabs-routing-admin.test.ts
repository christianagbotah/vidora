import { describe, expect, test } from "bun:test";
import {
  normalizeElevenLabsVoiceMap,
  previewElevenLabsVoiceRoute,
} from "@/lib/elevenlabs-routing-admin";

describe("ElevenLabs routing admin", () => {
  test("normalizes JSON routing maps exactly as production expects", () => {
    expect(normalizeElevenLabsVoiceMap(`{
      " Profile:EN:Ghanaian:TongTong ": " voice-gh-narrator ",
      "LANGUAGE:FR": "voice-fr"
    }`)).toEqual({
      "profile:en:ghanaian:tongtong": "voice-gh-narrator",
      "language:fr": "voice-fr",
    });
  });

  test("rejects malformed or empty routing entries before preview", () => {
    expect(() => normalizeElevenLabsVoiceMap("not-json")).toThrow("valid JSON");
    expect(() => normalizeElevenLabsVoiceMap("[]")).toThrow("JSON object");
    expect(() => normalizeElevenLabsVoiceMap({ "accent:ghanaian": "" })).toThrow("non-empty ElevenLabs voice ID");
  });

  test("uses production precedence for an exact Ghanaian profile", () => {
    const preview = previewElevenLabsVoiceRoute({
      voiceMap: {
        "profile:en:ghanaian:tongtong": "voice-gh-exact",
        "accent:ghanaian": "voice-gh-fallback",
        "language:en": "voice-en",
        tongtong: "voice-tongtong",
      },
      defaultVoiceId: "voice-default",
      requestedVoice: "TongTong",
      language: "EN",
      accent: "Ghanaian",
    });

    expect(preview.candidates).toEqual([
      "profile:en:ghanaian:tongtong",
      "profile:en:ghanaian",
      "accent:en:ghanaian",
      "accent:ghanaian",
      "language:en",
      "tongtong",
    ]);
    expect(preview.matchedKey).toBe("profile:en:ghanaian:tongtong");
    expect(preview.resolvedVoice).toBe("voice-gh-exact");
    expect(preview.usedDefault).toBe(false);
  });

  test("reports the configured default when no route matches a logical voice", () => {
    const preview = previewElevenLabsVoiceRoute({
      voiceMap: {},
      defaultVoiceId: "voice-default",
      requestedVoice: "jam",
      language: "en",
      accent: "auto",
    });

    expect(preview.matchedKey).toBeNull();
    expect(preview.resolvedVoice).toBe("voice-default");
    expect(preview.usedDefault).toBe(true);
  });
});
