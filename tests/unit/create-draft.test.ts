import { describe, expect, test } from "bun:test";
import {
  createDraftDescription,
  normalizedCharacterName,
  sanitizeCreateDraftSnapshot,
} from "../../src/lib/create-draft-server";

describe("create draft snapshot", () => {
  test("sanitizes untrusted wizard state and removes unsupported image URLs", () => {
    const snapshot = sanitizeCreateDraftSnapshot({
      inputMode: "script",
      scriptText: "  INT. STUDIO - DAY  ",
      selectedDuration: 999,
      createStep: 99,
      parsedScenes: [
        {
          prompt: "Scene one",
          title: "Opening",
          characterNames: [" Ada ", 123, "Bob"],
        },
        { title: "missing prompt" },
        null,
      ],
      parsedCharacters: [
        { name: " Ada ", role: "lead", description: "Hero" },
        { name: "ada", role: "duplicate" },
        { name: "Bob", role: "supporting" },
        { name: "" },
      ],
      preCharImages: {
        Ada: "data:image/png;base64,aGVsbG8=",
        Bob: "/generated/drafts/example/bob.png",
        Mallory: "https://attacker.example/image.png",
      },
    });

    expect(snapshot.inputMode).toBe("script");
    expect(snapshot.selectedDuration).toBe(300);
    expect(snapshot.createStep).toBe(2);
    expect(snapshot.parsedScenes).toHaveLength(1);
    expect(snapshot.parsedScenes[0].characterNames).toEqual(["Ada", "Bob"]);
    expect(snapshot.parsedCharacters.map((character) => character.name)).toEqual(["Ada", "Bob"]);
    expect(snapshot.preCharImages.Ada).toStartWith("data:image/png");
    expect(snapshot.preCharImages.Bob).toStartWith("/generated/");
    expect(snapshot.preCharImages.Mallory).toBeUndefined();
    expect(snapshot.savedAt).toBeTruthy();
  });

  test("creates a concise project description from the active content", () => {
    const script = sanitizeCreateDraftSnapshot({
      inputMode: "script",
      scriptText: "A".repeat(350),
    });
    expect(createDraftDescription(script)).toHaveLength(200);

    const prompt = sanitizeCreateDraftSnapshot({
      inputMode: "text",
      textPrompt: "original",
      enhancedText: "enhanced prompt",
    });
    expect(createDraftDescription(prompt)).toBe("enhanced prompt");
  });

  test("normalizes character identity consistently", () => {
    expect(normalizedCharacterName("  Ada LOVELACE ")).toBe("ada lovelace");
  });
});
