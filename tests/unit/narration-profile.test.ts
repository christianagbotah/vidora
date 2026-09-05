import { describe, expect, test } from "bun:test";
import {
  DEFAULT_NARRATION_PROFILE,
  buildNarrationPerformanceDirection,
  normalizeNarrationProfile,
} from "@/lib/narration-profile";

describe("narration profile", () => {
  test("normalizes supported language, accent and style", () => {
    expect(
      normalizeNarrationProfile({
        language: " TWI ",
        accent: "native",
        style: "storyteller",
      }),
    ).toEqual({
      language: "twi",
      accent: "native",
      style: "storyteller",
    });
  });

  test("falls back safely for unknown options", () => {
    expect(
      normalizeNarrationProfile({
        language: "not-a-language",
        accent: "invented",
        style: "invented",
      }),
    ).toEqual(DEFAULT_NARRATION_PROFILE);
  });

  test("keeps performance direction separate from spoken text", () => {
    expect(
      buildNarrationPerformanceDirection(
        { language: "en", accent: "ghanaian", style: "documentary" },
        "softly",
      ),
    ).toBe("softly, use a ghanaian english accent, documentary delivery");
  });

  test("describes native non-English delivery", () => {
    expect(
      buildNarrationPerformanceDirection({
        language: "twi",
        accent: "native",
        style: "storyteller",
      }),
    ).toBe("speak naturally in Twi (Akan), use a native / local accent, storyteller delivery");
  });
});
