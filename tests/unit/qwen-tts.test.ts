import { describe, expect, test } from "bun:test";
import {
  DEFAULT_QWEN_TTS_MODEL,
  DEFAULT_QWEN_TTS_VOICE,
  qwenInstructFallbackVoice,
  qwenLanguageType,
  qwenPerformanceInstruction,
  resolveQwenTtsModel,
  resolveQwenVoice,
  resolveQwenVoiceForModel,
  splitQwenTtsInput,
} from "@/lib/qwen-tts";
import { readFileSync } from "fs";
import path from "path";

describe("Qwen3-TTS provider compatibility", () => {
  test("upgrades basic Qwen3 Flash to the instruction-capable production model", () => {
    expect(DEFAULT_QWEN_TTS_MODEL).toBe("qwen3-tts-instruct-flash");
    expect(resolveQwenTtsModel("")).toBe(DEFAULT_QWEN_TTS_MODEL);
    expect(resolveQwenTtsModel("zai-tts")).toBe(DEFAULT_QWEN_TTS_MODEL);
    expect(resolveQwenTtsModel("eleven_v3")).toBe(DEFAULT_QWEN_TTS_MODEL);
    expect(resolveQwenTtsModel("qwen3-tts-flash")).toBe(DEFAULT_QWEN_TTS_MODEL);
    expect(resolveQwenTtsModel("qwen3-tts-flash-2025-11-27")).toBe(DEFAULT_QWEN_TTS_MODEL);
    expect(resolveQwenTtsModel("qwen3-tts-instruct-flash")).toBe("qwen3-tts-instruct-flash");
    expect(resolveQwenTtsModel("qwen3-tts-instruct-flash-2026-01-26")).toBe("qwen3-tts-instruct-flash-2026-01-26");
  });

  test("turns Vidora performance metadata into Qwen instruction control", () => {
    const instruction = qwenPerformanceInstruction({
      input: "Move out!",
      direction: "excited and heroic",
      speed: 1.18,
      accent: "ghanaian",
    });
    expect(instruction).toContain("excited and heroic");
    expect(instruction).toContain("faster pace");
    expect(instruction).toContain("ghanaian accent");
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

  test("remaps Flash-only Ryan to an expressive Instruct-compatible character voice", () => {
    expect(
      resolveQwenVoiceForModel("Ryan", "luodo", "qwen3-tts-instruct-flash", "Cherry"),
    ).toBe("Bellona");
    expect(
      resolveQwenVoiceForModel("ryan", "luodo", "qwen3-tts-instruct-flash-2026-01-26", "Cherry"),
    ).toBe("Bellona");
    expect(
      resolveQwenVoiceForModel("Pip", "chuichui", "qwen3-tts-instruct-flash", "Cherry"),
    ).toBe("Pip");
  });

  test("keeps character-aware safe fallbacks for provider-side voice rejection", () => {
    expect(qwenInstructFallbackVoice("tongtong", "Cherry")).toBe("Cherry");
    expect(qwenInstructFallbackVoice("chuichui", "Cherry")).toBe("Pip");
    expect(qwenInstructFallbackVoice("luodo", "Cherry")).toBe("Bellona");
    expect(qwenInstructFallbackVoice("kazi", "Cherry")).toBe("Ethan");
    expect(qwenInstructFallbackVoice("jam", "Cherry")).toBe("Eldric Sage");
    expect(qwenInstructFallbackVoice("unknown", "Ryan")).toBe("Cherry");
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
    const migration = readFileSync(
      path.join(process.cwd(), "prisma/migrations/20260908001000_qwen_instruct_voice_compat/migration.sql"),
      "utf8",
    );
    expect(tsconfig).toContain('"@/lib/ai-provider-router"');
    expect(tsconfig).toContain("ai-provider-router-qwen.ts");
    expect(preflight).toContain('settings.ttsProvider === "qwen"');
    expect(preflight).toContain("probeQwenTts()");
    expect(migration).toContain('"Ryan"');
    expect(migration).toContain('"Bellona"');
  });
});
