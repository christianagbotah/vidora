/**
 * ───────────────────────────────────────────────────────────────────────────
 *  Vidora — Dubbing Language Catalog (single source of truth)
 * ───────────────────────────────────────────────────────────────────────────
 *
 *  Used by BOTH the backend dubbing API route (`/api/scenes/[id]/dubbing`)
 *  and the frontend dubbing language picker in `page.tsx`.
 *
 *  Keeping the list in ONE place guarantees the UI and the API never drift
 *  out of sync (which was the root cause of "English is missing" bug).
 *
 *  Languages are grouped for UX. The `code` is the ISO 639-1 / short code
 *  sent to the API; `name` is the display name; `flag` is the emoji flag.
 * ───────────────────────────────────────────────────────────────────────────
 */

export interface DubbingLanguage {
  code: string;
  name: string;
  flag: string;
  /** TTS voice hint — most languages use the default "tongtong" voice, but
   *  some may map better to a specific voice. Reserved for future use. */
  voice?: string;
}

export interface DubbingLanguageGroup {
  label: string;
  languages: DubbingLanguage[];
}

/**
 * Grouped language catalog. English is always first (most requested),
 * then major world languages, then West African languages (relevant to the
 * Africa/Accra timezone), then other African languages.
 */
export const DUBBING_LANGUAGE_GROUPS: DubbingLanguageGroup[] = [
  {
    label: "Popular",
    languages: [
      { code: "en", name: "English", flag: "🇬🇧" },
      { code: "fr", name: "French", flag: "🇫🇷" },
      { code: "es", name: "Spanish", flag: "🇪🇸" },
      { code: "pt", name: "Portuguese", flag: "🇵🇹" },
      { code: "ar", name: "Arabic", flag: "🇸🇦" },
      { code: "zh", name: "Chinese (Mandarin)", flag: "🇨🇳" },
    ],
  },
  {
    label: "European",
    languages: [
      { code: "de", name: "German", flag: "🇩🇪" },
      { code: "it", name: "Italian", flag: "🇮🇹" },
      { code: "nl", name: "Dutch", flag: "🇳🇱" },
      { code: "ru", name: "Russian", flag: "🇷🇺" },
      { code: "pl", name: "Polish", flag: "🇵🇱" },
      { code: "tr", name: "Turkish", flag: "🇹🇷" },
      { code: "sv", name: "Swedish", flag: "🇸🇪" },
    ],
  },
  {
    label: "Asian",
    languages: [
      { code: "ja", name: "Japanese", flag: "🇯🇵" },
      { code: "ko", name: "Korean", flag: "🇰🇷" },
      { code: "hi", name: "Hindi", flag: "🇮🇳" },
      { code: "id", name: "Indonesian", flag: "🇮🇩" },
      { code: "th", name: "Thai", flag: "🇹🇭" },
      { code: "vi", name: "Vietnamese", flag: "🇻🇳" },
    ],
  },
  {
    label: "West African",
    languages: [
      { code: "twi", name: "Twi (Akan)", flag: "🇬🇭" },
      { code: "ga", name: "Ga", flag: "🇬🇭" },
      { code: "ha", name: "Hausa", flag: "🇬🇭" },
      { code: "yo", name: "Yoruba", flag: "🇳🇬" },
      { code: "ig", name: "Igbo", flag: "🇳🇬" },
      { code: "ee", name: "Ewe", flag: "🇬🇭" },
      { code: "dag", name: "Dagbani", flag: "🇬🇭" },
    ],
  },
  {
    label: "Other African",
    languages: [
      { code: "sw", name: "Swahili", flag: "🇰🇪" },
      { code: "am", name: "Amharic", flag: "🇪🇹" },
      { code: "zu", name: "Zulu", flag: "🇿🇦" },
      { code: "af", name: "Afrikaans", flag: "🇿🇦" },
      { code: "xh", name: "Xhosa", flag: "🇿🇦" },
    ],
  },
];

/** Flat map of code → language, for O(1) lookups in the API. */
export const DUBBING_LANGUAGES: Record<string, DubbingLanguage> =
  DUBBING_LANGUAGE_GROUPS.reduce<Record<string, DubbingLanguage>>((acc, group) => {
    for (const lang of group.languages) {
      acc[lang.code] = lang;
    }
    return acc;
  }, {});

/** Flat list of all languages (English first). */
export const ALL_DUBBING_LANGUAGES: DubbingLanguage[] =
  DUBBING_LANGUAGE_GROUPS.flatMap((g) => g.languages);

/** Total count (for display). */
export const DUBBING_LANGUAGE_COUNT = ALL_DUBBING_LANGUAGES.length;

/**
 * Validates a language code and returns the language metadata, or null if
 * the code is not supported.
 */
export function getDubbingLanguage(code: string): DubbingLanguage | null {
  return DUBBING_LANGUAGES[code] ?? null;
}
