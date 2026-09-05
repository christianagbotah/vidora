import { describe, expect, test } from "bun:test";
import { buildProfessionalSceneDirectorPrompt } from "@/lib/ai-provider-router";
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
    expect(prompt.systemPrompt).toContain("exactly 3 scenes");
  });

  test("speaker-aware parser keeps each birthday line attached to its character", () => {
    const segments = parseDialogueSegments([
      "Narrator: Today is Giannis' birthday!",
      "Chase: Happy birthday, Giannis!",
      "Marshall (excited): Have an amazing birthday, Giannis!",
      "Everyone: We hope your day is full of fun!",
    ].join("\n"));

    expect(segments).toEqual([
      { speaker: "Narrator", text: "Today is Giannis' birthday!" },
      { speaker: "Chase", text: "Happy birthday, Giannis!" },
      { speaker: "Marshall", text: "Have an amazing birthday, Giannis!" },
      { speaker: "Everyone", text: "We hope your day is full of fun!" },
    ]);
  });

  test("legacy single-voice helper still removes attribution without dropping words", () => {
    const result = stripSpeakerAttributions([
      "Chase: Today is Giannis' birthday!",
      "Marshall: Happy birthday, Giannis!",
    ].join("\n"));
    expect(result).toBe("Today is Giannis' birthday! Happy birthday, Giannis!");
  });
});
