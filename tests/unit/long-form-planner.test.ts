import { describe, expect, test } from "bun:test";
import {
  LongFormPlanValidationError,
  buildLongFormPlannerPrompt,
  normalizeLongFormRequest,
  parseLongFormPlan,
} from "@/lib/long-form-planner";

const source = "A determined young engineer in Accra discovers a hidden family secret and must choose between ambition, loyalty, and protecting her community.";

function validPlanJson(seasons = 1, episodesPerSeason = 1, format = "film"): string {
  return JSON.stringify({
    format,
    storyBible: {
      title: "The Hidden Current",
      logline: "An ambitious engineer discovers a secret that forces her to redefine success.",
      genre: "Drama",
      tone: "Emotional, grounded and cinematic",
      audience: "General adult and family audience",
      themes: ["family", "ambition", "community"],
      emotionalPromise: "A moving story about choosing purpose without abandoning ambition.",
      world: "Contemporary Accra, moving between a modern engineering office and a close-knit neighborhood.",
      visualLanguage: "Naturalistic lenses, controlled handheld intimacy, warm practical light and deliberate wide establishing shots.",
      soundLanguage: "Intimate dialogue, restrained score, city ambience and emotionally purposeful silence.",
      continuityRules: [
        "The protagonist keeps the same silver wristwatch throughout the story.",
        "The family house exterior remains cream with a green gate.",
      ],
      characters: [{
        name: "Ama",
        role: "Protagonist",
        objective: "Win a major engineering contract while protecting her family.",
        conflict: "The contract is connected to a secret that could harm her community.",
        arc: "She moves from achievement-at-all-costs to a mature definition of leadership.",
        visualContinuity: "Early-30s Ghanaian woman, neat natural hair, navy workwear, silver wristwatch.",
        voiceContinuity: "Calm Ghanaian English, measured pace, becoming warmer and more vulnerable over time.",
      }],
      locations: [{
        name: "Family House",
        purpose: "The emotional center of the family conflict.",
        visualContinuity: "Cream exterior, green gate, shaded veranda, warm tungsten interiors.",
        soundContinuity: "Neighborhood voices, distant traffic, birds and room-tone ceiling fan.",
      }],
    },
    seasons: Array.from({ length: seasons }, (_, seasonIndex) => ({
      seasonNumber: seasonIndex + 1,
      title: seasons === 1 ? "The Hidden Current" : `Season ${seasonIndex + 1}`,
      arc: `Season ${seasonIndex + 1} escalates Ama's conflict and forces a meaningful choice.`,
      episodes: Array.from({ length: episodesPerSeason }, (_, episodeIndex) => ({
        episodeNumber: episodeIndex + 1,
        title: `Episode ${episodeIndex + 1}`,
        logline: `Ama faces the next consequence in episode ${episodeIndex + 1}.`,
        targetMinutes: 25,
        openingHook: "A discovery immediately destabilizes Ama's plan.",
        emotionalArc: "Confidence gives way to doubt, confrontation and a more grounded resolve.",
        actBeats: [
          "Open on a concrete problem that demands an immediate choice.",
          "Reveal new information that complicates Ama's goal.",
          "Force a confrontation between professional and family loyalties.",
          "End with a decision whose consequences carry forward.",
        ],
        payoffOrCliffhanger: "Ama commits to a choice that creates the next dramatic problem.",
      })),
    })),
  });
}

describe("long-form request normalization", () => {
  test("uses professional defaults for a feature film", () => {
    const spec = normalizeLongFormRequest({ source, format: "film" });
    expect(spec.format).toBe("film");
    expect(spec.seasons).toBe(1);
    expect(spec.episodesPerSeason).toBe(1);
    expect(spec.episodeTargetMinutes).toBe(90);
    expect(spec.totalTargetMinutes).toBe(90);
  });

  test("bounds a series to at most 60 total episodes", () => {
    const spec = normalizeLongFormRequest({
      source,
      format: "series",
      seasons: 8,
      episodesPerSeason: 24,
      episodeMinutes: 45,
    });
    expect(spec.seasons).toBe(8);
    expect(spec.episodesPerSeason).toBe(7);
    expect(spec.seasons * spec.episodesPerSeason).toBeLessThanOrEqual(60);
    expect(spec.episodeTargetMinutes).toBe(45);
  });

  test("rejects too-short source material and unknown formats", () => {
    expect(() => normalizeLongFormRequest({ source: "too short", format: "film" })).toThrow(LongFormPlanValidationError);
    expect(() => normalizeLongFormRequest({ source, format: "random" })).toThrow("format must be");
  });
});

describe("long-form director prompt", () => {
  test("builds hierarchy and explicitly forbids premature shot generation", () => {
    const spec = normalizeLongFormRequest({
      source,
      format: "series",
      seasons: 2,
      episodesPerSeason: 4,
      episodeMinutes: 30,
    });
    const prompt = buildLongFormPlannerPrompt(spec);
    expect(prompt.systemPrompt).toContain("continuity source of truth");
    expect(prompt.userPrompt).toContain("exactly 2 season objects");
    expect(prompt.userPrompt).toContain("exactly 4 episode objects");
    expect(prompt.userPrompt).toContain("do not generate hundreds of shot/scene prompts");
    expect(prompt.userPrompt).toContain("visualContinuity");
    expect(prompt.userPrompt).toContain("voiceContinuity");
  });
});

describe("long-form plan validation", () => {
  test("accepts and normalizes a valid film story bible", () => {
    const spec = normalizeLongFormRequest({ source, format: "film", targetMinutes: 105 });
    const plan = parseLongFormPlan(validPlanJson(1, 1, "film"), spec);
    expect(plan.format).toBe("film");
    expect(plan.storyBible.characters[0].name).toBe("Ama");
    expect(plan.storyBible.continuityRules.length).toBe(2);
    expect(plan.seasons).toHaveLength(1);
    expect(plan.seasons[0].episodes).toHaveLength(1);
    expect(plan.seasons[0].episodes[0].targetMinutes).toBe(105);
  });

  test("accepts the exact requested series hierarchy", () => {
    const spec = normalizeLongFormRequest({
      source,
      format: "series",
      seasons: 2,
      episodesPerSeason: 2,
      episodeMinutes: 25,
    });
    const plan = parseLongFormPlan(validPlanJson(2, 2, "series"), spec);
    expect(plan.seasons).toHaveLength(2);
    expect(plan.seasons.every((season) => season.episodes.length === 2)).toBe(true);
    expect(plan.seasons[1].seasonNumber).toBe(2);
    expect(plan.seasons[1].episodes[1].episodeNumber).toBe(2);
  });

  test("rejects truncated or structurally wrong provider output", () => {
    const spec = normalizeLongFormRequest({
      source,
      format: "series",
      seasons: 2,
      episodesPerSeason: 2,
    });
    expect(() => parseLongFormPlan("{bad-json", spec)).toThrow("invalid JSON");
    expect(() => parseLongFormPlan(validPlanJson(1, 2, "series"), spec)).toThrow("Expected exactly 2 season");
    expect(() => parseLongFormPlan(validPlanJson(2, 1, "series"), spec)).toThrow("must contain exactly 2 episode");
  });
});
