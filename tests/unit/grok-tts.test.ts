import { describe, expect, test } from "bun:test";
import {
  DEFAULT_GROK_TTS_MODEL,
  DEFAULT_GROK_TTS_VOICE,
  grokLanguageCode,
  resolveGrokVoice,
} from "@/lib/grok-tts";
import { readFileSync } from "fs";
import path from "path";

const voices = [
  { voice_id: "orion", name: "Orion", language: "multilingual" },
  { voice_id: "cosmo", name: "Cosmo", language: "multilingual" },
  { voice_id: "perseus", name: "Perseus", language: "multilingual" },
  { voice_id: "zagan", name: "Zagan", language: "multilingual" },
  { voice_id: "carina", name: "Carina", language: "multilingual" },
  { voice_id: "rigel", name: "Rigel", language: "multilingual" },
  { voice_id: "altair", name: "Altair", language: "multilingual" },
  { voice_id: "eve", name: "Eve", language: "multilingual" },
  { voice_id: "ara", name: "Ara", language: "multilingual" },
  { voice_id: "leo", name: "Leo", language: "multilingual" },
  { voice_id: "rex", name: "Rex", language: "multilingual" },
  { voice_id: "sal", name: "Sal", language: "multilingual" },
];

describe("Grok TTS provider", () => {
  test("uses the stable Grok TTS model and safe language routing", () => {
    expect(DEFAULT_GROK_TTS_MODEL).toBe("grok-tts");
    expect(DEFAULT_GROK_TTS_VOICE).toBe("orion");
    expect(grokLanguageCode("en")).toBe("en");
    expect(grokLanguageCode("fr")).toBe("fr");
    expect(grokLanguageCode("Spanish")).toBe("es-ES");
    expect(grokLanguageCode("tw")).toBe("auto");
    expect(grokLanguageCode("ga")).toBe("auto");
  });

  test("profile-aware mappings win over automatic provider voice casting", async () => {
    const settings = {
      defaultVoice: "orion",
      voiceMap: {
        "profile:fr:ghanaian:kazi": "rex",
        "language:fr": "ara",
      },
    };
    expect(await resolveGrokVoice("kazi", settings, voices, { language: "fr", accent: "ghanaian" })).toBe("rex");
    expect(await resolveGrokVoice("jam", settings, voices, { language: "fr", accent: "auto" })).toBe("ara");
  });

  test("casts Vidora logical archetypes to matching Grok voice personalities", async () => {
    const settings = { defaultVoice: "orion", voiceMap: {} };
    expect(await resolveGrokVoice("tongtong", settings, voices, { language: "en", accent: "auto" })).toBe("orion");
    expect(await resolveGrokVoice("chuichui", settings, voices, { language: "en", accent: "auto" })).toBe("cosmo");
    expect(await resolveGrokVoice("kazi", settings, voices, { language: "en", accent: "auto" })).toBe("perseus");
    expect(await resolveGrokVoice("luodo", settings, voices, { language: "en", accent: "auto" })).toBe("zagan");
    expect(await resolveGrokVoice("douji", settings, voices, { language: "en", accent: "auto" })).toBe("carina");
    expect(await resolveGrokVoice("xiaochen", settings, voices, { language: "en", accent: "auto" })).toBe("rigel");
    expect(await resolveGrokVoice("jam", settings, voices, { language: "en", accent: "auto" })).toBe("altair");
  });

  test("falls back safely when a preferred new voice is absent from an account roster", async () => {
    const limited = voices.filter((voice) => ["eve", "ara", "leo", "rex", "sal"].includes(voice.voice_id));
    const settings = { defaultVoice: "orion", voiceMap: {} };
    const narrator = await resolveGrokVoice("tongtong", settings, limited, { language: "en", accent: "auto" });
    const chase = await resolveGrokVoice("kazi", settings, limited, { language: "en", accent: "auto" });
    expect(narrator).toBe("eve");
    expect(chase).toBe("rex");
    expect(chase).not.toBe(narrator);
  });

  test("provider-native Voice Studio IDs pass through directly", async () => {
    const settings = { defaultVoice: "orion", voiceMap: {} };
    expect(await resolveGrokVoice("custom-voice-123", settings, voices, { language: "en", accent: "auto" })).toBe("custom-voice-123");
  });

  test("production routing and secret policy include Grok TTS", () => {
    const router = readFileSync(path.join(process.cwd(), "src/lib/ai-provider-router-qwen.ts"), "utf8");
    const secure = readFileSync(path.join(process.cwd(), "src/lib/secure-config.ts"), "utf8");
    const preflight = readFileSync(path.join(process.cwd(), "scripts/check-ai-provider-routing-live.ts"), "utf8");
    expect(router).toContain('configured === "grok"');
    expect(router).toContain("synthesizeGrokTts");
    expect(secure).toContain('"xai_tts_api_key"');
    expect(preflight).toContain('settings.ttsProvider === "grok"');
    expect(preflight).toContain("probeGrokTts()");
  });
});
