import { describe, expect, test } from "bun:test";
import { resolveZaiTtsModel } from "@/lib/zai";

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
