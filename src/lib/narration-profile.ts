import { DUBBING_LANGUAGES, getDubbingLanguage } from "@/lib/dubbing-languages";

/** Provider-neutral narration profile. Language affects the spoken source text;
 * accent/style are performance preferences and are applied only by providers
 * that support structured performance direction. */
export interface NarrationProfile {
  language: string;
  accent: string;
  style: string;
}

export interface NarrationOption {
  id: string;
  label: string;
  description?: string;
}

export const DEFAULT_NARRATION_PROFILE: NarrationProfile = {
  language: "en",
  accent: "auto",
  style: "natural",
};

export const NARRATION_ACCENTS: NarrationOption[] = [
  { id: "auto", label: "Automatic", description: "Let the selected voice/provider choose naturally" },
  { id: "neutral", label: "Neutral / International" },
  { id: "ghanaian", label: "Ghanaian English" },
  { id: "british", label: "British English" },
  { id: "american", label: "American English" },
  { id: "australian", label: "Australian English" },
  { id: "nigerian", label: "Nigerian English" },
  { id: "south-african", label: "South African English" },
  { id: "kenyan", label: "Kenyan English" },
  { id: "indian", label: "Indian English" },
  { id: "native", label: "Native / Local", description: "Use a natural native delivery for the selected language" },
];

export const NARRATION_STYLES: NarrationOption[] = [
  { id: "natural", label: "Natural", description: "Balanced everyday delivery" },
  { id: "warm", label: "Warm", description: "Friendly and reassuring" },
  { id: "conversational", label: "Conversational", description: "Relaxed, human dialogue" },
  { id: "cinematic", label: "Cinematic", description: "Dramatic trailer-style delivery" },
  { id: "documentary", label: "Documentary", description: "Measured factual narration" },
  { id: "storyteller", label: "Storyteller", description: "Expressive narrative pacing" },
  { id: "educational", label: "Educational", description: "Clear teaching/explainer delivery" },
  { id: "news", label: "News presenter", description: "Confident broadcast delivery" },
  { id: "energetic", label: "Energetic", description: "Upbeat promotional delivery" },
  { id: "calm", label: "Calm", description: "Soft, steady and composed" },
];

const ACCENT_IDS = new Set(NARRATION_ACCENTS.map((item) => item.id));
const STYLE_IDS = new Set(NARRATION_STYLES.map((item) => item.id));

export function normalizeNarrationLanguage(value?: string | null): string {
  const code = (value || DEFAULT_NARRATION_PROFILE.language).trim().toLowerCase();
  return getDubbingLanguage(code) ? code : DEFAULT_NARRATION_PROFILE.language;
}

export function normalizeNarrationAccent(value?: string | null): string {
  const accent = (value || DEFAULT_NARRATION_PROFILE.accent).trim().toLowerCase();
  return ACCENT_IDS.has(accent) ? accent : DEFAULT_NARRATION_PROFILE.accent;
}

export function normalizeNarrationStyle(value?: string | null): string {
  const style = (value || DEFAULT_NARRATION_PROFILE.style).trim().toLowerCase();
  return STYLE_IDS.has(style) ? style : DEFAULT_NARRATION_PROFILE.style;
}

export function normalizeNarrationProfile(value?: Partial<NarrationProfile> | null): NarrationProfile {
  return {
    language: normalizeNarrationLanguage(value?.language),
    accent: normalizeNarrationAccent(value?.accent),
    style: normalizeNarrationStyle(value?.style),
  };
}

export function getNarrationLanguageName(code: string): string {
  return DUBBING_LANGUAGES[normalizeNarrationLanguage(code)]?.name || "English";
}

/**
 * Performance-only direction. This must never be prepended to spoken input.
 * Z.AI currently ignores it; ElevenLabs v3 can use it as non-spoken direction.
 */
export function buildNarrationPerformanceDirection(
  profile: NarrationProfile,
  existingDirection?: string | null,
): string | null {
  const normalized = normalizeNarrationProfile(profile);
  const parts: string[] = [];

  if (existingDirection?.trim()) parts.push(existingDirection.trim());

  const languageName = getNarrationLanguageName(normalized.language);
  if (normalized.language !== "en") {
    parts.push(`speak naturally in ${languageName}`);
  }

  if (normalized.accent !== "auto") {
    const accent = NARRATION_ACCENTS.find((item) => item.id === normalized.accent)?.label;
    if (accent) parts.push(`use a ${accent.toLowerCase()} accent`);
  }

  if (normalized.style !== "natural") {
    const style = NARRATION_STYLES.find((item) => item.id === normalized.style)?.label;
    if (style) parts.push(`${style.toLowerCase()} delivery`);
  }

  return parts.length ? parts.join(", ") : null;
}

export function isEnglishAccent(accent: string): boolean {
  return [
    "ghanaian",
    "british",
    "american",
    "australian",
    "nigerian",
    "south-african",
    "kenyan",
    "indian",
  ].includes(normalizeNarrationAccent(accent));
}
