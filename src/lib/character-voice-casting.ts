export const AUTO_CHARACTER_VOICE_VERSION = "2026-09-07-v1";

export const AUTO_CHARACTER_VOICE_PALETTE = [
  "chuichui", // youthful / playful
  "kazi",     // energetic / heroic
  "douji",    // warm / gentle
  "luodo",    // expressive / dramatic
  "xiaochen", // calm / professional
  "jam",      // mature / grounded
] as const;

export type AutoCharacterVoice = (typeof AUTO_CHARACTER_VOICE_PALETTE)[number];

export interface CharacterVoiceProfile {
  id?: string | null;
  name: string;
  role?: string | null;
  description?: string | null;
  stylePrompt?: string | null;
  voiceId?: string | null;
}

const NARRATOR_LABELS = new Set(["narrator", "chorus", "all", "everyone"]);

export function normalizeCharacterName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function isNarratorSpeaker(value: string | null | undefined): boolean {
  return NARRATOR_LABELS.has(normalizeCharacterName(value || ""));
}

function profileText(character: CharacterVoiceProfile): string {
  return [
    character.name,
    character.role || "",
    character.description || "",
    character.stylePrompt || "",
  ]
    .join(" ")
    .toLocaleLowerCase();
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pushUnique(target: AutoCharacterVoice[], voice: AutoCharacterVoice): void {
  if (!target.includes(voice)) target.push(voice);
}

/**
 * Rank provider-neutral Vidora voice identities from a character profile.
 * The ranking intentionally describes broad vocal archetypes rather than
 * imitating a named performer. Provider adapters turn these logical voices
 * into distinct provider-native voices.
 */
export function rankAutoCharacterVoices(character: CharacterVoiceProfile): AutoCharacterVoice[] {
  const text = profileText(character);
  const ranked: AutoCharacterVoice[] = [];

  if (/\b(girl|female|woman|mother|mom|mum|sister|princess|queen)\b/i.test(text)) {
    pushUnique(ranked, "douji");
  }
  if (/\b(boy|male|kid|child|teen|pup|puppy|cub|young|playful|mischievous)\b/i.test(text)) {
    pushUnique(ranked, "chuichui");
  }
  if (/\b(hero|leader|police|officer|rescue|rescuer|brave|bold|energetic|athletic|pilot|firefighter)\b/i.test(text)) {
    pushUnique(ranked, "kazi");
  }
  if (/\b(expressive|dramatic|excited|comic|funny|enthusiastic|adventurous)\b/i.test(text)) {
    pushUnique(ranked, "luodo");
  }
  if (/\b(calm|professional|scientist|teacher|doctor|mentor|precise|serious|wise)\b/i.test(text)) {
    pushUnique(ranked, "xiaochen");
  }
  if (/\b(elder|old|mature|grandfather|grandmother|veteran|gruff|deep|grounded)\b/i.test(text)) {
    pushUnique(ranked, "jam");
  }

  const seed = stableHash(`${character.id || ""}|${normalizeCharacterName(character.name)}`);
  for (let offset = 0; offset < AUTO_CHARACTER_VOICE_PALETTE.length; offset += 1) {
    pushUnique(
      ranked,
      AUTO_CHARACTER_VOICE_PALETTE[(seed + offset) % AUTO_CHARACTER_VOICE_PALETTE.length],
    );
  }

  return ranked;
}

export function chooseAutoCharacterVoice(
  character: CharacterVoiceProfile,
  usedVoices: ReadonlySet<string> = new Set(),
): AutoCharacterVoice {
  const ranked = rankAutoCharacterVoices(character);
  return ranked.find((voice) => !usedVoices.has(voice)) || ranked[0];
}

/**
 * Build stable project-wide voice assignments. Explicit user assignments win.
 * Missing voices are auto-cast while avoiding duplicate logical voices until
 * the small palette is exhausted. Because callers pass all project characters
 * in stable order, the same character keeps the same automatic voice across
 * every scene without needing a schema migration.
 */
export function assignProjectCharacterVoices(
  characters: CharacterVoiceProfile[],
): Map<string, string> {
  const assignments = new Map<string, string>();
  const used = new Set<string>();

  for (const character of characters) {
    const explicit = character.voiceId?.trim();
    if (!explicit) continue;
    assignments.set(normalizeCharacterName(character.name), explicit);
    used.add(explicit.toLocaleLowerCase());
  }

  for (const character of characters) {
    const key = normalizeCharacterName(character.name);
    if (!key || assignments.has(key)) continue;
    const voice = chooseAutoCharacterVoice(character, used);
    assignments.set(key, voice);
    used.add(voice);
  }

  return assignments;
}

export function autoVoiceForUnlinkedSpeaker(
  speaker: string,
  usedVoices: ReadonlySet<string> = new Set(),
): AutoCharacterVoice {
  return chooseAutoCharacterVoice({ name: speaker, role: "dialogue speaker" }, usedVoices);
}
