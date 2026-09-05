import { db } from "@/lib/db";
import { ALL_DUBBING_LANGUAGES } from "@/lib/dubbing-languages";

/** Voice Studio and scene dubbing share one language catalog. */
export const VOICE_LANGUAGES = [
  { id: "auto", label: "Auto detect" },
  ...ALL_DUBBING_LANGUAGES.map((language) => ({
    id: language.code,
    label: `${language.flag} ${language.name}`,
  })),
];

export const VOICE_ACCENTS = [
  { id: "auto", label: "Auto / provider default" },
  { id: "neutral", label: "Neutral / international" },
  { id: "gh", label: "Ghanaian English" },
  { id: "ng", label: "Nigerian English" },
  { id: "za", label: "South African English" },
  { id: "gb", label: "British English" },
  { id: "us", label: "American English" },
  { id: "au", label: "Australian English" },
  { id: "in", label: "Indian English" },
] as const;

export const LOGICAL_VOICES = [
  { id: "auto", label: "AI / automatic", description: "Choose a suitable voice automatically" },
  { id: "tongtong", label: "TongTong", description: "Warm & friendly narrator" },
  { id: "chuichui", label: "ChuiChui", description: "Playful & cute" },
  { id: "xiaochen", label: "XiaoChen", description: "Professional & calm" },
  { id: "jam", label: "Jam", description: "British gentleman" },
  { id: "kazi", label: "Kazi", description: "Clear & standard" },
  { id: "douji", label: "DouJi", description: "Natural & smooth" },
  { id: "luodo", label: "LuoDo", description: "Expressive & engaging" },
] as const;

export const VOICE_STYLES = [
  { id: "auto", label: "AI / automatic" },
  { id: "natural", label: "Natural" },
  { id: "warm", label: "Warm" },
  { id: "documentary", label: "Documentary" },
  { id: "cinematic", label: "Cinematic" },
  { id: "conversational", label: "Conversational" },
  { id: "educational", label: "Educational" },
  { id: "news", label: "News presenter" },
  { id: "energetic", label: "Energetic" },
  { id: "calm", label: "Calm" },
  { id: "storyteller", label: "Storyteller" },
] as const;

export type VoiceStyle = typeof VOICE_STYLES[number]["id"];

export interface VoiceProfile {
  language: string;
  accent: string;
  voice: string;
  style: VoiceStyle;
  /** 0 is reserved as an inheritance sentinel for scene/character overrides. */
  speed: number;
}

export const DEFAULT_VOICE_PROFILE: VoiceProfile = {
  language: "auto",
  accent: "auto",
  voice: "auto",
  style: "natural",
  speed: 1,
};

export const INHERIT_VOICE_PROFILE: VoiceProfile = {
  language: "auto",
  accent: "auto",
  voice: "auto",
  style: "auto",
  speed: 0,
};

const LANGUAGE_IDS = new Set<string>(VOICE_LANGUAGES.map((item) => item.id));
const ACCENT_IDS = new Set<string>(VOICE_ACCENTS.map((item) => item.id));
const STYLE_IDS = new Set<string>(VOICE_STYLES.map((item) => item.id));
const LOGICAL_VOICE_IDS = new Set<string>(LOGICAL_VOICES.map((item) => item.id));

function cleanToken(value: unknown, fallback: string, allowed?: Set<string>): string {
  if (typeof value !== "string") return fallback;
  const clean = value.trim().toLowerCase().slice(0, 80);
  if (!clean) return fallback;
  if (allowed && !allowed.has(clean)) return fallback;
  return clean;
}

function cleanVoice(value: unknown): string {
  if (typeof value !== "string") return "auto";
  const raw = value.trim().slice(0, 160);
  if (!raw) return "auto";
  const logical = raw.toLowerCase();
  return LOGICAL_VOICE_IDS.has(logical) ? logical : raw;
}

export function sanitizeVoiceProfile(value: unknown): VoiceProfile {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const speedRaw = Number(input.speed);
  const speed = speedRaw === 0
    ? 0
    : Number.isFinite(speedRaw)
      ? Math.max(0.7, Math.min(1.3, speedRaw))
      : 1;
  return {
    language: cleanToken(input.language, "auto", LANGUAGE_IDS),
    accent: cleanToken(input.accent, "auto", ACCENT_IDS),
    // Known Vidora voices are normalized; provider-native IDs retain casing.
    voice: cleanVoice(input.voice),
    style: cleanToken(input.style, "natural", STYLE_IDS) as VoiceStyle,
    speed,
  };
}

/** Merge explicit overrides onto a base profile. `auto`/speed 0 mean inherit. */
export function mergeVoiceProfiles(base: VoiceProfile, override?: Partial<VoiceProfile> | null): VoiceProfile {
  if (!override) return sanitizeVoiceProfile(base);
  const raw = sanitizeVoiceProfile({ ...INHERIT_VOICE_PROFILE, ...override });
  const merged: VoiceProfile = {
    language: raw.language === "auto" ? base.language : raw.language,
    accent: raw.accent === "auto" ? base.accent : raw.accent,
    voice: raw.voice === "auto" ? base.voice : raw.voice,
    style: raw.style === "auto" ? base.style : raw.style,
    speed: raw.speed === 0 ? base.speed : raw.speed,
  };
  return sanitizeVoiceProfile(merged);
}

export function styleDelivery(style: string): { direction: string | null; speedFactor: number; expression: number } {
  switch (style) {
    case "warm": return { direction: "warmly", speedFactor: 0.97, expression: 0.24 };
    case "documentary": return { direction: "calmly", speedFactor: 0.94, expression: 0.12 };
    case "cinematic": return { direction: "proudly", speedFactor: 0.93, expression: 0.34 };
    case "conversational": return { direction: null, speedFactor: 1.02, expression: 0.16 };
    case "educational": return { direction: "calmly", speedFactor: 0.96, expression: 0.08 };
    case "news": return { direction: null, speedFactor: 1.01, expression: 0.04 };
    case "energetic": return { direction: "excited", speedFactor: 1.08, expression: 0.48 };
    case "calm": return { direction: "calmly", speedFactor: 0.9, expression: 0.08 };
    case "storyteller": return { direction: "warmly", speedFactor: 0.94, expression: 0.3 };
    default: return { direction: null, speedFactor: 1, expression: 0 };
  }
}

export function projectVoiceProfileKey(projectId: string): string {
  return `voice_profile:project:${projectId}`;
}
export function characterVoiceProfileKey(characterId: string): string {
  return `voice_profile:character:${characterId}`;
}
export function sceneVoiceProfileKey(sceneId: string): string {
  return `voice_profile:scene:${sceneId}`;
}

export async function readVoiceProfile(key: string): Promise<VoiceProfile | null> {
  const row = await db.systemConfig.findUnique({ where: { key }, select: { value: true } });
  if (!row?.value) return null;
  try {
    return sanitizeVoiceProfile(JSON.parse(row.value));
  } catch {
    return null;
  }
}

export async function writeVoiceProfile(key: string, profile: unknown, description: string): Promise<VoiceProfile> {
  const sanitized = sanitizeVoiceProfile(profile);
  await db.systemConfig.upsert({
    where: { key },
    update: { value: JSON.stringify(sanitized), description },
    create: { key, value: JSON.stringify(sanitized), description },
  });
  return sanitized;
}

export async function deleteVoiceProfile(key: string): Promise<void> {
  await db.systemConfig.deleteMany({ where: { key } });
}
