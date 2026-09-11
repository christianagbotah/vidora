export type LongFormFormat = "film" | "series" | "episode" | "short_story";

export interface NormalizedLongFormRequest {
  format: LongFormFormat;
  title: string | null;
  source: string;
  seasons: number;
  episodesPerSeason: number;
  episodeTargetMinutes: number;
  totalTargetMinutes: number;
}

export interface LongFormCharacterBible {
  name: string;
  role: string;
  objective: string;
  conflict: string;
  arc: string;
  visualContinuity: string;
  voiceContinuity: string;
}

export interface LongFormLocationBible {
  name: string;
  purpose: string;
  visualContinuity: string;
  soundContinuity: string;
}

export interface LongFormStoryBible {
  title: string;
  logline: string;
  genre: string;
  tone: string;
  audience: string;
  themes: string[];
  emotionalPromise: string;
  world: string;
  visualLanguage: string;
  soundLanguage: string;
  continuityRules: string[];
  characters: LongFormCharacterBible[];
  locations: LongFormLocationBible[];
}

export interface LongFormEpisodePlan {
  episodeNumber: number;
  title: string;
  logline: string;
  targetMinutes: number;
  openingHook: string;
  emotionalArc: string;
  actBeats: string[];
  payoffOrCliffhanger: string;
}

export interface LongFormSeasonPlan {
  seasonNumber: number;
  title: string;
  arc: string;
  episodes: LongFormEpisodePlan[];
}

export interface LongFormPlan {
  format: LongFormFormat;
  storyBible: LongFormStoryBible;
  seasons: LongFormSeasonPlan[];
}

export class LongFormPlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LongFormPlanValidationError";
  }
}

const MAX_SOURCE_CHARS = 40_000;
const MAX_TOTAL_EPISODES = 60;

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function cleanOptionalTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim().slice(0, 180);
  return cleaned || null;
}

export function normalizeLongFormRequest(input: {
  format?: unknown;
  title?: unknown;
  source: unknown;
  targetMinutes?: unknown;
  seasons?: unknown;
  episodesPerSeason?: unknown;
  episodeMinutes?: unknown;
}): NormalizedLongFormRequest {
  const source = typeof input.source === "string" ? input.source.trim() : "";
  if (source.length < 20) throw new LongFormPlanValidationError("A longer story brief or source script is required");
  if (source.length > MAX_SOURCE_CHARS) throw new LongFormPlanValidationError(`Source material is too long (max ${MAX_SOURCE_CHARS} characters)`);

  const rawFormat = typeof input.format === "string" ? input.format.trim().toLowerCase() : "film";
  if (!["film", "series", "episode", "short_story"].includes(rawFormat)) {
    throw new LongFormPlanValidationError("format must be film, series, episode, or short_story");
  }
  const format = rawFormat as LongFormFormat;

  if (format === "series") {
    const seasons = clampInt(input.seasons, 1, 1, 8);
    let episodesPerSeason = clampInt(input.episodesPerSeason, 6, 1, 24);
    episodesPerSeason = Math.min(episodesPerSeason, Math.max(1, Math.floor(MAX_TOTAL_EPISODES / seasons)));
    const episodeTargetMinutes = clampInt(input.episodeMinutes, 25, 5, 90);
    return {
      format,
      title: cleanOptionalTitle(input.title),
      source,
      seasons,
      episodesPerSeason,
      episodeTargetMinutes,
      totalTargetMinutes: seasons * episodesPerSeason * episodeTargetMinutes,
    };
  }

  const targetFallback = format === "film" ? 90 : format === "episode" ? 30 : 8;
  const targetMax = format === "film" ? 180 : format === "episode" ? 90 : 20;
  const targetMin = format === "short_story" ? 1 : 5;
  const episodeTargetMinutes = clampInt(input.targetMinutes, targetFallback, targetMin, targetMax);
  return {
    format,
    title: cleanOptionalTitle(input.title),
    source,
    seasons: 1,
    episodesPerSeason: 1,
    episodeTargetMinutes,
    totalTargetMinutes: episodeTargetMinutes,
  };
}

export function buildLongFormPlannerPrompt(spec: NormalizedLongFormRequest): {
  systemPrompt: string;
  userPrompt: string;
} {
  const formatLabel = spec.format === "series"
    ? `${spec.seasons}-season series with exactly ${spec.episodesPerSeason} episodes per season`
    : spec.format === "film"
      ? "single feature film"
      : spec.format === "episode"
        ? "single episodic story"
        : "single short story film";

  const systemPrompt = [
    "You are Vidora's senior long-form showrunner, screenwriter, continuity editor, cinematography planner, and sound director.",
    "Design a production architecture, not individual 10-second generation scenes yet.",
    "The output becomes the continuity source of truth for later sequence/scene/shot expansion, so internal consistency matters more than decorative prose.",
    "Preserve explicit names, relationships, ages, places, chronology, brands, factual constraints, and emotional intent supplied by the user.",
    "Do not invent unsupported real-world facts, endorsements, prices, awards, certifications, or exact trademark/logo details.",
    "For fictional characters, define stable appearance, wardrobe/prop anchors, voice traits, motivations, and arc continuity that later generators can reuse.",
    "Build emotional escalation and release deliberately: hooks, reversals, conflict, quiet beats, payoff, cliffhangers where appropriate, and season-level character progression.",
    "Think like a professional production team: writing, directing, camera language, editing rhythm, production design, score, ambience, dialogue, and continuity must reinforce the same story.",
    "Return ONLY valid JSON. No markdown and no commentary outside JSON.",
  ].join("\n");

  const titleInstruction = spec.title ? `Working title: ${spec.title}` : "Create an appropriate working title from the source.";
  const userPrompt = [
    `FORMAT: ${formatLabel}`,
    titleInstruction,
    `Target duration per episode/film unit: ${spec.episodeTargetMinutes} minutes.`,
    spec.format === "series"
      ? `Return exactly ${spec.seasons} season objects and exactly ${spec.episodesPerSeason} episode objects inside every season.`
      : "Return exactly 1 season object containing exactly 1 episode/film-unit object.",
    "",
    "SOURCE MATERIAL:",
    spec.source,
    "",
    "REQUIRED JSON SHAPE:",
    JSON.stringify({
      format: spec.format,
      storyBible: {
        title: "string",
        logline: "string",
        genre: "string",
        tone: "string",
        audience: "string",
        themes: ["string"],
        emotionalPromise: "string",
        world: "string",
        visualLanguage: "camera/lens/movement/lighting/color/edit language",
        soundLanguage: "voice/dialogue/score/ambience/sound-design language",
        continuityRules: ["stable rule later scenes must preserve"],
        characters: [{
          name: "string",
          role: "string",
          objective: "string",
          conflict: "string",
          arc: "string",
          visualContinuity: "stable appearance/wardrobe/prop anchors",
          voiceContinuity: "voice/accent/cadence/emotional delivery anchors",
        }],
        locations: [{
          name: "string",
          purpose: "string",
          visualContinuity: "stable geography/design/light anchors",
          soundContinuity: "stable ambience/acoustic anchors",
        }],
      },
      seasons: [{
        seasonNumber: 1,
        title: "string",
        arc: "season or film-level dramatic arc",
        episodes: [{
          episodeNumber: 1,
          title: "string",
          logline: "string",
          targetMinutes: spec.episodeTargetMinutes,
          openingHook: "string",
          emotionalArc: "string",
          actBeats: ["6-12 ordered high-level beats; not generation scenes"],
          payoffOrCliffhanger: "string",
        }],
      }],
    }),
    "",
    "QUALITY RULES:",
    "- Story-bible facts must be concrete enough to enforce continuity later.",
    "- Every major character needs a motivation, conflict and progression, not just an appearance description.",
    "- Each episode needs a distinct dramatic purpose while advancing the larger arc.",
    "- Avoid repetitive episode structures and generic filler beats.",
    "- actBeats are macro beats only; do not generate hundreds of shot/scene prompts in this call.",
  ].join("\n");

  return { systemPrompt, userPrompt };
}

function cleanString(value: unknown, field: string, max = 2_000): string {
  if (typeof value !== "string") throw new LongFormPlanValidationError(`${field} must be a string`);
  const cleaned = value.replace(/\s+/g, " ").trim().slice(0, max);
  if (!cleaned) throw new LongFormPlanValidationError(`${field} is required`);
  return cleaned;
}

function cleanStringArray(value: unknown, field: string, maxItems: number, maxChars = 1_000): string[] {
  if (!Array.isArray(value)) throw new LongFormPlanValidationError(`${field} must be an array`);
  return value.slice(0, maxItems).map((item, index) => cleanString(item, `${field}[${index}]`, maxChars));
}

function stripJsonFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

export function parseLongFormPlan(raw: string, spec: NormalizedLongFormRequest): LongFormPlan {
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(stripJsonFence(raw)) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    parsed = value as Record<string, unknown>;
  } catch {
    throw new LongFormPlanValidationError("The long-form director returned invalid JSON");
  }

  if (parsed.format !== spec.format) {
    throw new LongFormPlanValidationError(`The long-form director returned format ${String(parsed.format)} instead of ${spec.format}`);
  }
  const bibleRaw = parsed.storyBible;
  if (!bibleRaw || typeof bibleRaw !== "object" || Array.isArray(bibleRaw)) {
    throw new LongFormPlanValidationError("storyBible is required");
  }
  const bible = bibleRaw as Record<string, unknown>;

  const charactersRaw = Array.isArray(bible.characters) ? bible.characters : [];
  const characters: LongFormCharacterBible[] = charactersRaw.slice(0, 40).map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new LongFormPlanValidationError(`storyBible.characters[${index}] must be an object`);
    }
    const item = value as Record<string, unknown>;
    return {
      name: cleanString(item.name, `character ${index + 1} name`, 160),
      role: cleanString(item.role, `character ${index + 1} role`, 300),
      objective: cleanString(item.objective, `character ${index + 1} objective`),
      conflict: cleanString(item.conflict, `character ${index + 1} conflict`),
      arc: cleanString(item.arc, `character ${index + 1} arc`, 3_000),
      visualContinuity: cleanString(item.visualContinuity, `character ${index + 1} visualContinuity`, 2_000),
      voiceContinuity: cleanString(item.voiceContinuity, `character ${index + 1} voiceContinuity`, 2_000),
    };
  });

  const locationsRaw = Array.isArray(bible.locations) ? bible.locations : [];
  const locations: LongFormLocationBible[] = locationsRaw.slice(0, 50).map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new LongFormPlanValidationError(`storyBible.locations[${index}] must be an object`);
    }
    const item = value as Record<string, unknown>;
    return {
      name: cleanString(item.name, `location ${index + 1} name`, 180),
      purpose: cleanString(item.purpose, `location ${index + 1} purpose`, 1_500),
      visualContinuity: cleanString(item.visualContinuity, `location ${index + 1} visualContinuity`, 2_000),
      soundContinuity: cleanString(item.soundContinuity, `location ${index + 1} soundContinuity`, 2_000),
    };
  });

  const storyBible: LongFormStoryBible = {
    title: cleanString(bible.title, "storyBible.title", 180),
    logline: cleanString(bible.logline, "storyBible.logline", 1_000),
    genre: cleanString(bible.genre, "storyBible.genre", 300),
    tone: cleanString(bible.tone, "storyBible.tone", 600),
    audience: cleanString(bible.audience, "storyBible.audience", 600),
    themes: cleanStringArray(bible.themes, "storyBible.themes", 12, 500),
    emotionalPromise: cleanString(bible.emotionalPromise, "storyBible.emotionalPromise", 1_500),
    world: cleanString(bible.world, "storyBible.world", 4_000),
    visualLanguage: cleanString(bible.visualLanguage, "storyBible.visualLanguage", 3_000),
    soundLanguage: cleanString(bible.soundLanguage, "storyBible.soundLanguage", 3_000),
    continuityRules: cleanStringArray(bible.continuityRules, "storyBible.continuityRules", 30, 1_000),
    characters,
    locations,
  };

  if (!Array.isArray(parsed.seasons) || parsed.seasons.length !== spec.seasons) {
    throw new LongFormPlanValidationError(`Expected exactly ${spec.seasons} season object(s)`);
  }

  const seasons: LongFormSeasonPlan[] = parsed.seasons.map((seasonValue, seasonIndex) => {
    if (!seasonValue || typeof seasonValue !== "object" || Array.isArray(seasonValue)) {
      throw new LongFormPlanValidationError(`season ${seasonIndex + 1} must be an object`);
    }
    const season = seasonValue as Record<string, unknown>;
    if (!Array.isArray(season.episodes) || season.episodes.length !== spec.episodesPerSeason) {
      throw new LongFormPlanValidationError(`Season ${seasonIndex + 1} must contain exactly ${spec.episodesPerSeason} episode(s)`);
    }
    const episodes: LongFormEpisodePlan[] = season.episodes.map((episodeValue, episodeIndex) => {
      if (!episodeValue || typeof episodeValue !== "object" || Array.isArray(episodeValue)) {
        throw new LongFormPlanValidationError(`episode ${episodeIndex + 1} must be an object`);
      }
      const episode = episodeValue as Record<string, unknown>;
      return {
        episodeNumber: episodeIndex + 1,
        title: cleanString(episode.title, `season ${seasonIndex + 1} episode ${episodeIndex + 1} title`, 180),
        logline: cleanString(episode.logline, `season ${seasonIndex + 1} episode ${episodeIndex + 1} logline`, 1_000),
        targetMinutes: spec.episodeTargetMinutes,
        openingHook: cleanString(episode.openingHook, `season ${seasonIndex + 1} episode ${episodeIndex + 1} openingHook`, 1_500),
        emotionalArc: cleanString(episode.emotionalArc, `season ${seasonIndex + 1} episode ${episodeIndex + 1} emotionalArc`, 2_000),
        actBeats: cleanStringArray(episode.actBeats, `season ${seasonIndex + 1} episode ${episodeIndex + 1} actBeats`, 14, 1_500),
        payoffOrCliffhanger: cleanString(episode.payoffOrCliffhanger, `season ${seasonIndex + 1} episode ${episodeIndex + 1} payoffOrCliffhanger`, 1_500),
      };
    });
    return {
      seasonNumber: seasonIndex + 1,
      title: cleanString(season.title, `season ${seasonIndex + 1} title`, 180),
      arc: cleanString(season.arc, `season ${seasonIndex + 1} arc`, 4_000),
      episodes,
    };
  });

  return { format: spec.format, storyBible, seasons };
}
