import { describe, expect, test } from "bun:test";
import {
  voiceStudioBulkProfileStatus,
  voiceStudioProjectHasPersistedDefault,
  voiceStudioProjectSaveMessage,
} from "@/lib/voice-studio-project-status";

describe("Voice Studio whole-video project status", () => {
  test("requires a fresh preview only when current scenes changed", () => {
    expect(voiceStudioProjectSaveMessage({ changed: true, defaultsChanged: true, changedSceneCount: 2 }))
      .toContain("updated 2 current scenes");
    expect(voiceStudioProjectSaveMessage({ changed: true, changedSceneCount: 1 }))
      .toContain("fresh full-video preview is required");
  });

  test("distinguishes defaults-only persistence from a cut mutation", () => {
    const message = voiceStudioProjectSaveMessage({
      changed: false,
      defaultsChanged: true,
      changedSceneCount: 0,
    });
    expect(message).toContain("default for future scenes");
    expect(message).toContain("does not need a new preview");
  });

  test("reports an already-saved matching default", () => {
    expect(voiceStudioProjectSaveMessage({ changed: false, defaultsChanged: false, changedSceneCount: 0 }))
      .toContain("already saved");
  });

  test("detects a durable project default only when every profile dimension is persisted", () => {
    expect(voiceStudioProjectHasPersistedDefault({
      narrationLang: "en",
      narrationAccent: "ghanaian",
      narrationStyle: "warm",
      narrationVoice: "tongtong",
    })).toBe(true);
    expect(voiceStudioProjectHasPersistedDefault({
      narrationLang: "en",
      narrationAccent: "ghanaian",
      narrationStyle: null,
      narrationVoice: "tongtong",
    })).toBe(false);
    expect(voiceStudioProjectHasPersistedDefault({})).toBe(false);
  });

  test("explains persisted versus legacy scene-derived bulk profiles", () => {
    expect(voiceStudioBulkProfileStatus(true)).toEqual({
      label: "Saved project default",
      description: "New scenes inherit this profile automatically. Individual scenes can still override it below.",
    });
    expect(voiceStudioBulkProfileStatus(false).label).toBe("Not saved as project default");
    expect(voiceStudioBulkProfileStatus(false).description).toContain("inferred from existing scenes");
  });
});
