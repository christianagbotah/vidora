import { describe, expect, test } from "bun:test";
import type { LongFormEpisodeContext } from "@/lib/long-form-store";
import {
  LongFormSequenceValidationError,
  buildEpisodeSequencePrompt,
  parseEpisodeSequencePlan,
  targetSequenceCount,
} from "@/lib/long-form-sequence-planner";

const context: LongFormEpisodeContext = {
  productionId: "production-1",
  productionTitle: "The Hidden Current",
  format: "series",
  storyBible: {
    title: "The Hidden Current",
    logline: "Ama discovers a secret that tests her ambition and loyalty.",
    genre: "Drama",
    tone: "Grounded and cinematic",
    audience: "General adult audience",
    themes: ["family", "ambition"],
    emotionalPromise: "A moving conflict between success and responsibility.",
    world: "Contemporary Accra.",
    visualLanguage: "Naturalistic lenses, deliberate wides, warm practical light.",
    soundLanguage: "Intimate dialogue, city ambience, restrained score.",
    continuityRules: ["Ama wears a silver wristwatch throughout this episode."],
    characters: [{
      name: "Ama",
      role: "Protagonist",
      objective: "Protect her family while winning a contract.",
      conflict: "The contract threatens her community.",
      arc: "She redefines leadership.",
      visualContinuity: "Early-30s Ghanaian woman, navy workwear, silver wristwatch.",
      voiceContinuity: "Measured Ghanaian English, increasingly vulnerable.",
    }],
    locations: [{
      name: "Family House",
      purpose: "Emotional center of the conflict.",
      visualContinuity: "Cream exterior, green gate, warm interiors.",
      soundContinuity: "Neighborhood voices and distant traffic.",
    }],
  },
  season: {
    id: "season-1",
    seasonNumber: 1,
    title: "Fault Lines",
    arc: "Ama's professional opportunity exposes a family secret.",
  },
  episode: {
    id: "episode-1",
    episodeNumber: 1,
    title: "The Offer",
    logline: "Ama receives the opportunity that begins the central conflict.",
    targetMinutes: 25,
    openingHook: "A surprise call offers Ama the contract of her career.",
    emotionalArc: "Excitement becomes suspicion and moral unease.",
    actBeats: [
      "Ama receives the offer.",
      "She discovers a hidden connection to her family.",
      "The community consequence becomes visible.",
      "Ama chooses to investigate before signing.",
    ],
    payoffOrCliffhanger: "Ama opens a file that proves the secret is real.",
    status: "planned",
    expansionVersion: 0,
  },
};

function validSequenceJson(seconds = 300): string {
  const count = targetSequenceCount(context.episode.targetMinutes);
  return JSON.stringify({
    sequences: Array.from({ length: count }, (_, index) => ({
      sequenceNumber: index + 1,
      title: `Sequence ${index + 1}`,
      purpose: `Advance dramatic beat ${index + 1} and change Ama's position.`,
      startState: `Ama enters sequence ${index + 1} with unresolved tension.`,
      endState: `Ama leaves sequence ${index + 1} with new information and pressure.`,
      targetSeconds: seconds,
      continuity: {
        charactersPresent: ["Ama"],
        location: index < 2 ? "Engineering Office" : "Family House",
        timeOfDay: index < 3 ? "Afternoon" : "Evening",
        wardrobeProps: ["silver wristwatch"],
        emotionalState: "Increasingly conflicted but controlled.",
        cameraIntent: "Start composed, gradually move closer as pressure rises.",
        soundIntent: "Natural dialogue, city ambience, restrained score.",
        mustCarryForward: [`Consequence from sequence ${index + 1} remains active.`],
      },
    })),
  });
}

describe("episode sequence targeting", () => {
  test("scales sequence count with episode duration but keeps it bounded", () => {
    expect(targetSequenceCount(5)).toBe(2);
    expect(targetSequenceCount(25)).toBe(5);
    expect(targetSequenceCount(90)).toBe(18);
    expect(targetSequenceCount(500)).toBe(18);
  });

  test("prompt carries story-bible continuity and exact hierarchy requirements", () => {
    const prompt = buildEpisodeSequencePrompt(context);
    expect(prompt.sequenceCount).toBe(5);
    expect(prompt.systemPrompt).toContain("Continuity handoff is mandatory");
    expect(prompt.userPrompt).toContain("silver wristwatch");
    expect(prompt.userPrompt).toContain("exactly 5 sequences");
    expect(prompt.userPrompt).toContain("do not generate final 10-second video prompts");
  });
});

describe("episode sequence validation", () => {
  test("accepts a duration-balanced sequence map and normalizes numbering", () => {
    const sequences = parseEpisodeSequencePlan(validSequenceJson(), context);
    expect(sequences).toHaveLength(5);
    expect(sequences[0].sequenceNumber).toBe(1);
    expect(sequences[4].sequenceNumber).toBe(5);
    expect(sequences.reduce((sum, item) => sum + item.targetSeconds, 0)).toBe(1500);
    expect(sequences[0].continuity.wardrobeProps).toContain("silver wristwatch");
  });

  test("rejects wrong sequence count", () => {
    const parsed = JSON.parse(validSequenceJson()) as { sequences: unknown[] };
    parsed.sequences.pop();
    expect(() => parseEpisodeSequencePlan(JSON.stringify(parsed), context)).toThrow("Expected exactly 5 sequences");
  });

  test("rejects timing that cannot fit the approved episode duration", () => {
    expect(() => parseEpisodeSequencePlan(validSequenceJson(100), context)).toThrow("outside the allowed range");
  });

  test("rejects missing continuity snapshots", () => {
    const parsed = JSON.parse(validSequenceJson()) as { sequences: Array<Record<string, unknown>> };
    delete parsed.sequences[0].continuity;
    expect(() => parseEpisodeSequencePlan(JSON.stringify(parsed), context)).toThrow(LongFormSequenceValidationError);
  });
});
