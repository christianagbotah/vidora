import { describe, expect, test } from "bun:test";
import {
  elevenLabsVoiceCandidatesForPreview,
  previewElevenLabsVoiceResolution,
  validateElevenLabsVoiceMap,
} from "@/lib/elevenlabs-voice-map";

describe("ElevenLabs voice-map admin helpers", () => {
  test("validates and normalizes a voice map", () => {
    const result = validateElevenLabsVoiceMap(JSON.stringify({
      " PROFILE:fr:Ghanaian:Jam ": " voice-fr-gh-jam ",
      "accent:ghanaian": "voice-gh",
    }));

    expect(result.error).toBeNull();
    expect(result.entryCount).toBe(2);
    expect(result.map).toEqual({
      "profile:fr:ghanaian:jam": "voice-fr-gh-jam",
      "accent:ghanaian": "voice-gh",
    });
  });

  test("rejects malformed and structurally invalid maps", () => {
    expect(validateElevenLabsVoiceMap("{bad").error).toBe("Voice map must be valid JSON.");
    expect(validateElevenLabsVoiceMap("[]").error).toBe("Voice map must be a JSON object.");
    expect(validateElevenLabsVoiceMap('{"jam":""}').error).toContain("non-empty ElevenLabs voice ID");
  });

  test("uses the same specific-to-broad routing order as provider runtime", () => {
    expect(elevenLabsVoiceCandidatesForPreview("Jam", { language: "fr", accent: "ghanaian" })).toEqual([
      "profile:fr:ghanaian:jam",
      "profile:fr:ghanaian",
      "accent:fr:ghanaian",
      "accent:ghanaian",
      "language:fr",
      "jam",
    ]);
  });

  test("previews exact matched key before default fallback", () => {
    const resolved = previewElevenLabsVoiceResolution({
      rawMap: JSON.stringify({
        "accent:ghanaian": "voice-gh",
        "language:fr": "voice-fr",
      }),
      defaultVoiceId: "voice-default",
      requestedVoice: "jam",
      language: "fr",
      accent: "ghanaian",
    });
    expect(resolved.matchedKey).toBe("accent:ghanaian");
    expect(resolved.resolvedVoiceId).toBe("voice-gh");
    expect(resolved.usedDefault).toBe(false);

    const fallback = previewElevenLabsVoiceResolution({
      rawMap: "{}",
      defaultVoiceId: "voice-default",
      requestedVoice: "jam",
      language: "en",
      accent: "auto",
    });
    expect(fallback.matchedKey).toBeNull();
    expect(fallback.resolvedVoiceId).toBe("voice-default");
    expect(fallback.usedDefault).toBe(true);
  });
});
