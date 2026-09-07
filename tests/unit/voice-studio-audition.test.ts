import { describe, expect, test } from "bun:test";
import {
  buildVoiceStudioNarrationRequest,
  voiceStudioNarrationSuccessMessage,
} from "@/lib/voice-studio-audition";

describe("Voice Studio narration audition", () => {
  test("posts the exact unsaved scene profile to the shared narration endpoint", () => {
    expect(buildVoiceStudioNarrationRequest({
      projectId: "project-1",
      sceneId: "scene-2",
      profile: {
        language: "fr",
        accent: "ghanaian",
        style: "warm",
        voice: "jam",
      },
    })).toEqual({
      projectId: "project-1",
      sceneId: "scene-2",
      voice: "jam",
      language: "fr",
      accent: "ghanaian",
      style: "warm",
    });
  });

  test("explains replayed and newly charged narration clearly", () => {
    expect(voiceStudioNarrationSuccessMessage({
      replayed: true,
      tokensCharged: 0,
      languageName: "French",
    })).toContain("reused the existing matching performance");

    expect(voiceStudioNarrationSuccessMessage({
      replayed: false,
      tokensCharged: 2,
      languageName: "French",
    })).toContain("2 narration tokens were used");
  });
});
