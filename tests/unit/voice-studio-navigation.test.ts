import { describe, expect, test } from "bun:test";
import {
  shouldShowVoiceStudioLauncher,
  voiceStudioProjectHref,
} from "@/lib/voice-studio-navigation";

describe("Voice Studio project launcher navigation", () => {
  test("builds a project-specific Voice Studio route safely", () => {
    expect(voiceStudioProjectHref("project-123")).toBe("/voice-studio/project-123");
    expect(voiceStudioProjectHref("project with spaces")).toBe("/voice-studio/project%20with%20spaces");
    expect(voiceStudioProjectHref(null)).toBe("/voice-studio");
  });

  test("appears only inside the root project studio with a selected project", () => {
    expect(shouldShowVoiceStudioLauncher({
      pathname: "/",
      currentView: "studio",
      projectId: "project-123",
    })).toBe(true);

    expect(shouldShowVoiceStudioLauncher({
      pathname: "/",
      currentView: "dashboard",
      projectId: "project-123",
    })).toBe(false);

    expect(shouldShowVoiceStudioLauncher({
      pathname: "/voice-studio/project-123",
      currentView: "studio",
      projectId: "project-123",
    })).toBe(false);

    expect(shouldShowVoiceStudioLauncher({
      pathname: "/",
      currentView: "studio",
      projectId: null,
    })).toBe(false);
  });
});
