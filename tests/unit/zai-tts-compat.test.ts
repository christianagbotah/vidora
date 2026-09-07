import { describe, expect, test } from "bun:test";
import {
  DEFAULT_ZAI_TTS_BASE_URL,
  DEFAULT_ZAI_TTS_MODEL,
  buildZaiTtsSpeechEndpoint,
  resolveZaiTtsBaseUrl,
  resolveZaiTtsModel,
} from "@/lib/zai-tts-compat";

describe("Z.AI TTS model resolution", () => {
  test("uses an explicit reviewed speech model when provided", () => {
    expect(resolveZaiTtsModel(" custom-tts ", "glm-tts")).toBe("custom-tts");
  });

  test("uses the documented glm-tts model when configured correctly", () => {
    expect(resolveZaiTtsModel(undefined, " GLM-TTS ")).toBe("glm-tts");
    expect(DEFAULT_ZAI_TTS_MODEL).toBe("glm-tts");
  });

  test("does not leak stale cross-provider model values into Z.AI speech", () => {
    expect(resolveZaiTtsModel(undefined, "zai-tts")).toBe("glm-tts");
    expect(resolveZaiTtsModel(undefined, "eleven_v3")).toBe("glm-tts");
    expect(resolveZaiTtsModel(undefined, "eleven_multilingual_v2")).toBe("glm-tts");
  });

  test("falls back to glm-tts instead of sending an empty model", () => {
    expect(resolveZaiTtsModel("", "")).toBe("glm-tts");
    expect(resolveZaiTtsModel(undefined, undefined)).toBe("glm-tts");
  });
});

describe("Z.AI dedicated TTS endpoint resolution", () => {
  test("defaults to the documented BigModel GLM-TTS base URL", () => {
    expect(resolveZaiTtsBaseUrl()).toBe(DEFAULT_ZAI_TTS_BASE_URL);
    expect(DEFAULT_ZAI_TTS_BASE_URL).toBe("https://open.bigmodel.cn/api/paas/v4");
  });

  test("normalizes trailing slashes", () => {
    expect(resolveZaiTtsBaseUrl(" https://open.bigmodel.cn/api/paas/v4/// ")).toBe(
      "https://open.bigmodel.cn/api/paas/v4",
    );
  });

  test("builds the speech endpoint exactly once", () => {
    expect(buildZaiTtsSpeechEndpoint("https://open.bigmodel.cn/api/paas/v4")).toBe(
      "https://open.bigmodel.cn/api/paas/v4/audio/speech",
    );
    expect(buildZaiTtsSpeechEndpoint("https://open.bigmodel.cn/api/paas/v4/audio/speech")).toBe(
      "https://open.bigmodel.cn/api/paas/v4/audio/speech",
    );
  });
});
