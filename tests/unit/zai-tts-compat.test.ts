import { describe, expect, test } from "bun:test";
import {
  DEFAULT_ZAI_TTS_BASE_URL,
  buildZaiTtsSpeechEndpoint,
  resolveZaiTtsBaseUrl,
  resolveZaiTtsModel,
} from "@/lib/zai-tts-compat";

describe("Z.AI TTS model resolution", () => {
  test("uses the explicit speech model when provided", () => {
    expect(resolveZaiTtsModel(" custom-tts ", "glm-tts")).toBe("custom-tts");
  });

  test("uses configured ai_tts_model when no explicit model is provided", () => {
    expect(resolveZaiTtsModel(undefined, " glm-tts ")).toBe("glm-tts");
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
