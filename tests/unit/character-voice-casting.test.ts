import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";
import {
  assignProjectCharacterVoices,
  chooseAutoCharacterVoice,
  isNarratorSpeaker,
} from "@/lib/character-voice-casting";
import {
  hasMatchingSpeakerAttributions,
  rebuildSpeakerAwareTranslation,
} from "@/lib/scene-language";

describe("character-aware voice casting", () => {
  test("casts a youthful rescue-pup speaker away from the narrator voice", () => {
    const voice = chooseAutoCharacterVoice({
      name: "Chase",
      role: "police rescue pup",
      description: "A brave young energetic puppy leader",
    });
    expect(voice).toBe("chuichui");
    expect(voice).not.toBe("tongtong");
  });

  test("preserves explicit assignments and gives other characters distinct automatic voices", () => {
    const assignments = assignProjectCharacterVoices([
      { name: "Narrator", role: "narrator", voiceId: "tongtong" },
      { name: "Chase", role: "police rescue pup" },
      { name: "Marshall", role: "firefighter rescue pup" },
      { name: "Skye", role: "female pilot rescue pup" },
    ]);

    expect(assignments.get("narrator")).toBe("tongtong");
    expect(assignments.get("chase")).not.toBe("tongtong");
    expect(assignments.get("marshall")).not.toBe("tongtong");
    expect(assignments.get("skye")).not.toBe("tongtong");
    expect(new Set([
      assignments.get("chase"),
      assignments.get("marshall"),
      assignments.get("skye"),
    ]).size).toBe(3);
  });

  test("recognizes group/narrator labels so they retain the narrator voice", () => {
    expect(isNarratorSpeaker("Narrator")).toBe(true);
    expect(isNarratorSpeaker("Everyone")).toBe(true);
    expect(isNarratorSpeaker("Chase")).toBe(false);
  });

  test("speaker-aware translation reattaches source speaker labels in order", () => {
    const source = "Narrator: The team arrives.\nChase: We are ready!\nMarshall: Let's go!";
    const rebuilt = rebuildSpeakerAwareTranslation(source, [
      "L'équipe arrive.",
      "Nous sommes prêts !",
      "Allons-y !",
    ]);

    expect(rebuilt).toBe(
      "Narrator: L'équipe arrive.\nChase: Nous sommes prêts !\nMarshall: Allons-y !",
    );
    expect(hasMatchingSpeakerAttributions(source, rebuilt!)).toBe(true);
    expect(hasMatchingSpeakerAttributions(source, "L'équipe arrive. Nous sommes prêts ! Allons-y !")).toBe(false);
  });

  test("production migration maps every Vidora logical voice to a distinct Qwen system voice", () => {
    const migration = readFileSync(
      path.join(
        process.cwd(),
        "prisma/migrations/20260907233000_character_aware_qwen_voices/migration.sql",
      ),
      "utf8",
    );
    expect(migration).toContain('"tongtong":"Cherry"');
    expect(migration).toContain('"chuichui":"Pip"');
    expect(migration).toContain('"luodo":"Ryan"');
    expect(migration).toContain('"kazi":"Ethan"');
    expect(migration).toContain('"douji":"Serena"');
    expect(migration).toContain('"xiaochen":"Neil"');
    expect(migration).toContain('"jam":"Eldric Sage"');
    expect(migration).toContain('SET "narrationUrl" = NULL');
    expect(migration).toContain("SystemConfig_tts_derived_audio_invalidate");
  });
});
