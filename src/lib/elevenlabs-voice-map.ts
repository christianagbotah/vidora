export interface ElevenLabsVoiceMapValidation {
  map: Record<string, string>;
  error: string | null;
  entryCount: number;
}

function normalizedRoutingPart(value: string | null | undefined, fallback: string): string {
  const normalized = (value || "").trim().toLowerCase();
  return normalized || fallback;
}

export function validateElevenLabsVoiceMap(raw: string): ElevenLabsVoiceMapValidation {
  const text = raw.trim();
  if (!text) return { map: {}, error: null, entryCount: 0 };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { map: {}, error: "Voice map must be valid JSON.", entryCount: 0 };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { map: {}, error: "Voice map must be a JSON object.", entryCount: 0 };
  }

  const map: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
    const key = rawKey.trim().toLowerCase();
    if (!key) {
      return { map: {}, error: "Voice-map keys cannot be empty.", entryCount: 0 };
    }
    if (typeof rawValue !== "string" || !rawValue.trim()) {
      return { map: {}, error: `Voice-map entry '${rawKey}' must point to a non-empty ElevenLabs voice ID.`, entryCount: 0 };
    }
    map[key] = rawValue.trim();
  }

  return { map, error: null, entryCount: Object.keys(map).length };
}

export function elevenLabsVoiceCandidatesForPreview(
  requested: string | undefined,
  profile: { language?: string | null; accent?: string | null } = {},
): string[] {
  const voice = (requested || "").trim().toLowerCase();
  const language = normalizedRoutingPart(profile.language, "en");
  const accent = normalizedRoutingPart(profile.accent, "auto");
  const candidates = [
    voice ? `profile:${language}:${accent}:${voice}` : "",
    `profile:${language}:${accent}`,
    `accent:${language}:${accent}`,
    `accent:${accent}`,
    `language:${language}`,
    voice,
  ];
  return candidates.filter((value, index, all) => value && all.indexOf(value) === index);
}

export function previewElevenLabsVoiceResolution(opts: {
  rawMap: string;
  defaultVoiceId?: string | null;
  requestedVoice?: string | null;
  language?: string | null;
  accent?: string | null;
}): {
  validation: ElevenLabsVoiceMapValidation;
  candidates: string[];
  matchedKey: string | null;
  resolvedVoiceId: string | null;
  usedDefault: boolean;
} {
  const validation = validateElevenLabsVoiceMap(opts.rawMap);
  const candidates = elevenLabsVoiceCandidatesForPreview(opts.requestedVoice || undefined, {
    language: opts.language,
    accent: opts.accent,
  });
  if (validation.error) {
    return { validation, candidates, matchedKey: null, resolvedVoiceId: null, usedDefault: false };
  }

  for (const candidate of candidates) {
    const matched = validation.map[candidate];
    if (matched) {
      return {
        validation,
        candidates,
        matchedKey: candidate,
        resolvedVoiceId: matched,
        usedDefault: false,
      };
    }
  }

  const defaultVoice = (opts.defaultVoiceId || "").trim();
  return {
    validation,
    candidates,
    matchedKey: null,
    resolvedVoiceId: defaultVoice || null,
    usedDefault: Boolean(defaultVoice),
  };
}
