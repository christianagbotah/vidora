import { describe, expect, test } from "bun:test";
import {
  buildProfessionalSceneDirectorPrompt,
  formatElevenLabsPerformanceText,
  normalizePerformanceDirection,
} from "@/lib/ai-provider-router";
import { parseDialogueSegments, stripSpeakerAttributions } from "@/lib/narration";

describe("professional AI provider routing primitives", () => {
  test("birthday director preserves the user's honoree and demands explicit spoken greetings", () => {
    const prompt = buildProfessionalSceneDirectorPrompt({
      source: "Create a joyful birthday video. Today is Giannis' birthday. Chase and Marshall should wish Giannis a happy birthday.",
      targetDuration: 30,
      projectType: "birthday",
    });

    expect(prompt.userPrompt).toContain("Giannis");
    expect(prompt.userPrompt).toContain("birthday");
    expect(prompt.systemPrompt).toContain("Preserve every important proper name");
    expect(prompt.systemPrompt).toContain("Happy birthday, <name>!");
    expect(prompt.systemPrompt).toContain("Speaker: text");
    expect(prompt.systemPrompt).toContain("Speaker (excited): text");
    expect(prompt.systemPrompt).toContain("exactly 3 scenes");
  });

  test("speaker-aware parser keeps each birthday line and delivery cue attached to its character", () => {
    const segments = parseDialogueSegments([
      "Narrator (warmly): Today is Giannis' birthday!",
      "Chase: Happy birthday, Giannis!",
      "Marshall (excited): Have an amazing birthday, Giannis!",
      "Everyone (cheerfully): We hope your day is full of fun!",
    ].join("\n"));

    expect(segments).toEqual([
      { speaker: "Narrator", direction: "warmly", text: "Today is Giannis' birthday!" },
      { speaker: "Chase", direction: null, text: "Happy birthday, Giannis!" },
      { speaker: "Marshall", direction: "excited", text: "Have an amazing birthday, Giannis!" },
      { speaker: "Everyone", direction: "cheerfully", text: "We hope your day is full of fun!" },
    ]);
  });

  test("Eleven v3 receives supported performance tags but other models receive spoken words only", () => {
    expect(normalizePerformanceDirection("very excitedly")).toBe("excited");
    expect(normalizePerformanceDirection("whispering softly")).toBe("whispering");
    expect(normalizePerformanceDirection("DROP TABLE voices")).toBeNull();

    expect(
      formatElevenLabsPerformanceText("Happy birthday, Giannis!", "excited", "eleven_v3")
    ).toBe("[excited] Happy birthday, Giannis!");
    expect(
      formatElevenLabsPerformanceText("Happy birthday, Giannis!", "excited", "eleven_multilingual_v2")
    ).toBe("Happy birthday, Giannis!");
  });

  test("legacy single-voice helper still removes attribution without dropping words", () => {
    const result = stripSpeakerAttributions([
      "Chase: Today is Giannis' birthday!",
      "Marshall: Happy birthday, Giannis!",
    ].join("\n"));
    expect(result).toBe("Today is Giannis' birthday! Happy birthday, Giannis!");
  });
});
