import type { LongFormEpisodeContext } from "@/lib/long-form-store";

export interface SequenceContinuitySnapshot {
  charactersPresent: string[];
  location: string;
  timeOfDay: string;
  wardrobeProps: string[];
  emotionalState: string;
  cameraIntent: string;
  soundIntent: string;
  mustCarryForward: string[];
}

export interface LongFormSequencePlan {
  sequenceNumber: number;
  title: string;
  purpose: string;
  startState: string;
  endState: string;
  targetSeconds: number;
  continuity: SequenceContinuitySnapshot;
}

export class LongFormSequenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LongFormSequenceValidationError";
  }
}

export function targetSequenceCount(targetMinutes: number): number {
  const minutes = Math.max(1, Math.round(Number(targetMinutes) || 1));
  return Math.min(18, Math.max(2, Math.round(minutes / 5)));
}

export function buildEpisodeSequencePrompt(context: LongFormEpisodeContext): {
  systemPrompt: string;
  userPrompt: string;
  sequenceCount: number;
} {
  const sequenceCount = targetSequenceCount(context.episode.targetMinutes);
  const systemPrompt = [
    "You are Vidora's senior episode director, script editor, continuity supervisor, cinematography planner, and sound designer.",
    "Expand ONE already-approved episode into a sequence map. Do not rewrite the story bible, do not alter established facts, and do not generate final 10-second video prompts yet.",
    "Every sequence must cause a meaningful change in information, emotion, relationship, danger, objective, or dramatic position. No filler montage sequences unless the episode genuinely needs one.",
    "Continuity handoff is mandatory: the end state of sequence N must logically feed the start state of sequence N+1.",
    "Preserve the story bible's character appearance, wardrobe/prop anchors, voices, locations, visual language, sound language, chronology, and continuity rules.",
    "Camera and sound intent should be professional but concise: establish the visual/emotional grammar later scene generation must follow.",
    "Return ONLY valid JSON. No markdown or commentary.",
  ].join("\n");

  const userPrompt = [
    `PRODUCTION: ${context.productionTitle}`,
    `FORMAT: ${context.format}`,
    `SEASON ${context.season.seasonNumber}: ${context.season.title}`,
    `SEASON ARC: ${context.season.arc}`,
    `EPISODE ${context.episode.episodeNumber}: ${context.episode.title}`,
    `EPISODE TARGET: ${context.episode.targetMinutes} minutes`,
    `EPISODE LOGLINE: ${context.episode.logline}`,
    `OPENING HOOK: ${context.episode.openingHook}`,
    `EMOTIONAL ARC: ${context.episode.emotionalArc}`,
    `PAYOFF / CLIFFHANGER: ${context.episode.payoffOrCliffhanger}`,
    `APPROVED ACT BEATS: ${JSON.stringify(context.episode.actBeats)}`,
    "",
    "APPROVED STORY BIBLE — SOURCE OF TRUTH:",
    JSON.stringify(context.storyBible),
    "",
    `Return exactly ${sequenceCount} sequences in chronological order. Their targetSeconds should total approximately ${context.episode.targetMinutes * 60} seconds (within about 10%).`,
    "",
    "REQUIRED JSON SHAPE:",
    JSON.stringify({
      sequences: [{
        sequenceNumber: 1,
        title: "short production-facing title",
        purpose: "what changes dramatically and why this sequence exists",
        startState: "story/emotional state entering the sequence",
        endState: "story/emotional state after the sequence",
        targetSeconds: 240,
        continuity: {
          charactersPresent: ["exact story-bible names"],
          location: "approved or logically derived location",
          timeOfDay: "continuity-safe time of day",
          wardrobeProps: ["specific carry-over wardrobe/props"],
          emotionalState: "character emotional state that scene expansion must preserve",
          cameraIntent: "shot scale/movement/lens/edit rhythm intent",
          soundIntent: "dialogue/ambience/score/sound-design intent",
          mustCarryForward: ["facts or visual/audio state the next sequence must inherit"],
        },
      }],
    }),
    "",
    "RULES:",
    `- Exactly ${sequenceCount} sequence objects; no missing or duplicate numbers.`,
    "- Sequence targetSeconds must be at least 30 seconds.",
    "- Cover the approved act beats across the whole sequence map without repeating the same beat in multiple sequences.",
    "- Do not introduce a new named major character or rewrite a character's established visual/voice identity unless the source material explicitly requires it.",
    "- Do not fabricate real-world claims or trademark details.",
    "- The final sequence must deliver the approved payoff/cliffhanger rather than ending generically.",
  ].join("\n");

  return { systemPrompt, userPrompt, sequenceCount };
}

function cleanString(value: unknown, field: string, max = 2_000): string {
  if (typeof value !== "string") throw new LongFormSequenceValidationError(`${field} must be a string`);
  const clean = value.replace(/\s+/g, " ").trim().slice(0, max);
  if (!clean) throw new LongFormSequenceValidationError(`${field} is required`);
  return clean;
}

function cleanStringArray(value: unknown, field: string, maxItems: number, maxChars = 500): string[] {
  if (!Array.isArray(value)) throw new LongFormSequenceValidationError(`${field} must be an array`);
  return value.slice(0, maxItems).map((item, index) => cleanString(item, `${field}[${index}]`, maxChars));
}

function stripJsonFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

export function parseEpisodeSequencePlan(
  raw: string,
  context: LongFormEpisodeContext,
): LongFormSequencePlan[] {
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(stripJsonFence(raw)) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not object");
    parsed = value as Record<string, unknown>;
  } catch {
    throw new LongFormSequenceValidationError("The episode director returned invalid JSON");
  }

  const expectedCount = targetSequenceCount(context.episode.targetMinutes);
  if (!Array.isArray(parsed.sequences) || parsed.sequences.length !== expectedCount) {
    throw new LongFormSequenceValidationError(`Expected exactly ${expectedCount} sequences`);
  }

  const sequences: LongFormSequencePlan[] = parsed.sequences.map((rawSequence, index) => {
    if (!rawSequence || typeof rawSequence !== "object" || Array.isArray(rawSequence)) {
      throw new LongFormSequenceValidationError(`sequence ${index + 1} must be an object`);
    }
    const sequence = rawSequence as Record<string, unknown>;
    const continuityRaw = sequence.continuity;
    if (!continuityRaw || typeof continuityRaw !== "object" || Array.isArray(continuityRaw)) {
      throw new LongFormSequenceValidationError(`sequence ${index + 1}.continuity is required`);
    }
    const continuity = continuityRaw as Record<string, unknown>;
    const targetSeconds = Math.round(Number(sequence.targetSeconds));
    if (!Number.isFinite(targetSeconds) || targetSeconds < 30 || targetSeconds > 1_800) {
      throw new LongFormSequenceValidationError(`sequence ${index + 1}.targetSeconds is invalid`);
    }
    return {
      sequenceNumber: index + 1,
      title: cleanString(sequence.title, `sequence ${index + 1}.title`, 180),
      purpose: cleanString(sequence.purpose, `sequence ${index + 1}.purpose`, 2_500),
      startState: cleanString(sequence.startState, `sequence ${index + 1}.startState`, 2_500),
      endState: cleanString(sequence.endState, `sequence ${index + 1}.endState`, 2_500),
      targetSeconds,
      continuity: {
        charactersPresent: cleanStringArray(continuity.charactersPresent, `sequence ${index + 1}.continuity.charactersPresent`, 20, 160),
        location: cleanString(continuity.location, `sequence ${index + 1}.continuity.location`, 500),
        timeOfDay: cleanString(continuity.timeOfDay, `sequence ${index + 1}.continuity.timeOfDay`, 200),
        wardrobeProps: cleanStringArray(continuity.wardrobeProps, `sequence ${index + 1}.continuity.wardrobeProps`, 30, 500),
        emotionalState: cleanString(continuity.emotionalState, `sequence ${index + 1}.continuity.emotionalState`, 1_500),
        cameraIntent: cleanString(continuity.cameraIntent, `sequence ${index + 1}.continuity.cameraIntent`, 1_500),
        soundIntent: cleanString(continuity.soundIntent, `sequence ${index + 1}.continuity.soundIntent`, 1_500),
        mustCarryForward: cleanStringArray(continuity.mustCarryForward, `sequence ${index + 1}.continuity.mustCarryForward`, 20, 800),
      },
    };
  });

  const totalSeconds = sequences.reduce((sum, sequence) => sum + sequence.targetSeconds, 0);
  const expectedSeconds = context.episode.targetMinutes * 60;
  const ratio = totalSeconds / expectedSeconds;
  if (!Number.isFinite(ratio) || ratio < 0.85 || ratio > 1.15) {
    throw new LongFormSequenceValidationError(
      `Sequence timing totals ${totalSeconds}s, outside the allowed range for a ${expectedSeconds}s episode`,
    );
  }

  return sequences;
}
