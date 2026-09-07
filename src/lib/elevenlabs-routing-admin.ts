import {
  elevenLabsVoiceCandidates,
  resolveElevenLabsVoice,
} from "@/lib/ai-provider-router";

export interface ElevenLabsRoutingPreviewInput {
  voiceMap: unknown;
  defaultVoiceId?: unknown;
  requestedVoice?: unknown;
  language?: unknown;
  accent?: unknown;
}

export interface ElevenLabsRoutingPreview {
  voiceMap: Record<string, string>;
  candidates: string[];
  matchedKey: string | null;
  resolvedVoice: string;
  requestedVoice: string;
  language: string;
  accent: string;
  usedDefault: boolean;
  usedDirectProviderVoice: boolean;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeElevenLabsVoiceMap(value: unknown): Record<string, string> {
  let parsed = value;
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return {};
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new Error("Voice routing map must be valid JSON");
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Voice routing map must be a JSON object");
  }

  const normalized: Record<string, string> = {};
  for (const [rawKey, rawVoiceId] of Object.entries(parsed as Record<string, unknown>)) {
    const key = rawKey.trim().toLowerCase();
    const voiceId = stringValue(rawVoiceId);
    if (!key || !voiceId) {
      throw new Error("Every voice routing entry must map a non-empty key to a non-empty ElevenLabs voice ID");
    }
    normalized[key] = voiceId;
  }
  return normalized;
}

export function previewElevenLabsVoiceRoute(input: ElevenLabsRoutingPreviewInput): ElevenLabsRoutingPreview {
  const voiceMap = normalizeElevenLabsVoiceMap(input.voiceMap);
  const defaultVoiceId = stringValue(input.defaultVoiceId);
  const requestedVoice = stringValue(input.requestedVoice) || "tongtong";
  const language = stringValue(input.language).toLowerCase() || "en";
  const accent = stringValue(input.accent).toLowerCase() || "auto";
  const candidates = elevenLabsVoiceCandidates(requestedVoice, { language, accent });
  const matchedKey = candidates.find((candidate) => Boolean(voiceMap[candidate.toLowerCase()])) || null;
  const resolvedVoice = resolveElevenLabsVoice(
    requestedVoice,
    {
      elevenLabsVoiceMap: voiceMap,
      elevenLabsDefaultVoiceId: defaultVoiceId,
    },
    { language, accent },
  );

  return {
    voiceMap,
    candidates,
    matchedKey,
    resolvedVoice,
    requestedVoice: requestedVoice.toLowerCase(),
    language,
    accent,
    usedDefault: !matchedKey && Boolean(defaultVoiceId) && resolvedVoice === defaultVoiceId,
    usedDirectProviderVoice: !matchedKey && resolvedVoice === requestedVoice && resolvedVoice !== defaultVoiceId,
  };
}
