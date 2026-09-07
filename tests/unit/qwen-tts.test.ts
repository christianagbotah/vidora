import { describe, expect, test } from "bun:test";
import {
  DEFAULT_QWEN_TTS_MODEL,
  DEFAULT_QWEN_TTS_VOICE,
  qwenLanguageType,
  resolveQwenTtsModel,
  resolveQwenVoice,
  splitQwenTtsInput,
} from "@/lib/qwen-tts";
import { readFileSync } from "fs";
import path from "path";

describe("Qwen3-TTS provider compatibility", () => {
  test("uses the stable Qwen3-TTS model and ignores stale cross-provider model names", () => {
    expect(resolveQwenTtsModel("")).toBe(DEFAULT_QWEN_TTS_MODEL);
    expect(resolveQwenTtsModel("zai-tts")).toBe(DEFAULT_QWEN_TTS_MODEL);
    expect(resolveQwenTtsModel("eleven_v3")).toBe(DEFAULT_QWEN_TTS_MODEL);
    expect(resolveQwenTtsModel("qwen3-tts-flash")).toBe("qwen3-tts-flash");
    expect(resolveQwenTtsModel("qwen3-tts-instruct-flash")).toBe("qwen3-tts-instruct-flash");
    expect(resolveQwenTtsModel("qwen3-tts-flash-2025-11-27")).toBe("qwen3-tts-flash-2025-11-27");
  });

  test("maps supported Vidora languages to DashScope language_type and safely uses Auto otherwise", () => {
    expect(qwenLanguageType("en")).toBe("English");
    expect(qwenLanguageType("fr")).toBe("French");
    expect(qwenLanguageType("French")).toBe("French");
    expect(qwenLanguageType("tw")).toBe("Auto");
    expect(qwenLanguageType("ga")).toBe("Auto");
    expect(qwenLanguageType(undefined)).toBe("Auto");
  });

  test("resolves profile-aware voice maps before the Qwen default voice", () => {
    const settings = {
      defaultVoice: DEFAULT_QWEN_TTS_VOICE,
      voiceMap: {
        "profile:fr:ghanaian:jam": "Ryan",
        "language:fr": "Cherry",
        tongtong: "Cherry",
      },
    };
    expect(resolveQwenVoice("jam", settings, { language: "fr", accent: "ghanaian" })).toBe("Ryan");
    expect(resolveQwenVoice("tongtong", settings, { language: "en", accent: "auto" })).toBe("Cherry");
    expect(resolveQwenVoice("unknown", settings, { language: "de", accent: "auto" })).toBe(DEFAULT_QWEN_TTS_VOICE);
  });

  test("splits long legacy dialogue below the provider's 600-character request ceiling", () => {
    const text = `${"A".repeat(700)} ${"B".repeat(700)}. Final sentence.`;
    const chunks = splitQwenTtsInput(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 600)).toBe(true);
    expect(chunks.join("").replace(/\s+/g, "")).toBe(text.replace(/\s+/g, ""));
  });

  test("provider alias and production preflight cannot silently bypass Qwen routing", () => {
    const tsconfig = readFileSync(path.join(process.cwd(), "tsconfig.json"), "utf8");
    const preflight = readFileSync(path.join(process.cwd(), "scripts/check-ai-provider-routing-live.ts"), "utf8");
    expect(tsconfig).toContain('"@/lib/ai-provider-router"');
    expect(tsconfig).toContain("ai-provider-router-qwen.ts");
    expect(preflight).toContain('settings.ttsProvider === "qwen"');
    expect(preflight).toContain("probeQwenTts()");
  });
});
