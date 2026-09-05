import { describe, expect, test } from "bun:test";
import {
  buildSceneVideoPrompt,
  VIDEO_AUDIO_DIRECTIVE,
  type CharacterLike,
} from "@/lib/image-prompt";

describe("video audio direction", () => {
  test("always reserves explicit no-speech policy while retaining ambience/SFX", () => {
    const prompt = buildSceneVideoPrompt({
      scenePrompt: "A joyful birthday party with balloons as Chase runs toward the cake and waves to Giannis.",
      characters: [],
    });

    expect(prompt).toContain("ambience/SFX only");
    expect(prompt).toContain("no spoken words, dialogue, singing, or voice-over");
    expect(prompt).toContain("Vidora adds exact dialogue in post");
    expect(prompt.length).toBeLessThanOrEqual(500);
  });

  test("character-aware prompt still fits the hard provider limit with the audio directive intact", () => {
    const characters: CharacterLike[] = [
      {
        id: "chase",
        name: "Chase",
        description: "German Shepherd rescue pup wearing a blue police uniform and cap, expressive friendly eyes",
      },
      {
        id: "marshall",
        name: "Marshall",
        description: "Dalmatian rescue pup wearing a bright red firefighter uniform, playful energetic expression",
      },
    ];

    const prompt = buildSceneVideoPrompt({
      scenePrompt: "Chase and Marshall celebrate beside a birthday cake while confetti falls and Giannis smiles.",
      characters,
      linkedCharacterIds: JSON.stringify(["chase", "marshall"]),
    });

    expect(prompt).toContain("Chase");
    expect(prompt).toContain(VIDEO_AUDIO_DIRECTIVE.trim());
    expect(prompt.length).toBeLessThanOrEqual(500);
  });

  test("very long scene directions are truncated before, never through, the no-speech policy", () => {
    const prompt = buildSceneVideoPrompt({
      scenePrompt: "cinematic birthday celebration ".repeat(100),
      characters: [],
    });

    expect(prompt.endsWith(VIDEO_AUDIO_DIRECTIVE)).toBe(true);
    expect(prompt.length).toBeLessThanOrEqual(500);
  });
});
