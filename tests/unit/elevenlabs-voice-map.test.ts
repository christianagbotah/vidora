import { describe, expect, test } from "bun:test";
import {
  elevenLabsVoiceCandidates,
  resolveElevenLabsVoice,
} from "@/lib/ai-provider-router";
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

  test("uses the exact specific-to-broad candidate order from provider runtime", () => {
    const profile = { language: "fr", accent: "ghanaian" };
    const previewCandidates = elevenLabsVoiceCandidatesForPreview("Jam", profile);
    const runtimeCandidates = elevenLabsVoiceCandidates("Jam", profile);

    expect(previewCandidates).toEqual(runtimeCandidates);
    expect(previewCandidates).toEqual([
      "profile:fr:ghanaian:jam",
      "profile:fr:ghanaian",
      "accent:fr:ghanaian",
      "accent:ghanaian",
      "language:fr",
      "jam",
    ]);
  });

  test("previews exact matched key before default fallback", () => {
    const rawMap = JSON.stringify({
      "accent:ghanaian": "voice-gh",
      "language:fr": "voice-fr",
    });
    const resolved = previewElevenLabsVoiceResolution({
      rawMap,
      defaultVoiceId: "voice-default",
      requestedVoice: "jam",
      language: "fr",
      accent: "ghanaian",
    });
    expect(resolved.matchedKey).toBe("accent:ghanaian");
    expect(resolved.resolvedVoiceId).toBe("voice-gh");
    expect(resolved.usedDefault).toBe(false);
    expect(resolved.usedDirectProviderVoice).toBe(false);
    expect(resolved.resolvedVoiceId).toBe(resolveElevenLabsVoice("jam", {
      elevenLabsVoiceMap: validateElevenLabsVoiceMap(rawMap).map,
      elevenLabsDefaultVoiceId: "voice-default",
    }, { language: "fr", accent: "ghanaian" }));

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
    expect(fallback.usedDirectProviderVoice).toBe(false);
  });

  test("mirrors provider runtime when an explicit ElevenLabs voice ID is supplied", () => {
    const preview = previewElevenLabsVoiceResolution({
      rawMap: "{}",
      defaultVoiceId: "voice-default",
      requestedVoice: "NativeVoiceABC",
      language: "en",
      accent: "ghanaian",
    });
    const runtime = resolveElevenLabsVoice("NativeVoiceABC", {
      elevenLabsVoiceMap: {},
      elevenLabsDefaultVoiceId: "voice-default",
    }, { language: "en", accent: "ghanaian" });

    expect(preview.resolvedVoiceId).toBe(runtime);
    expect(preview.resolvedVoiceId).toBe("NativeVoiceABC");
    expect(preview.usedDefault).toBe(false);
    expect(preview.usedDirectProviderVoice).toBe(true);
  });
});
