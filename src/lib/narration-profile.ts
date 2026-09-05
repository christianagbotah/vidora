import { db } from "@/lib/db";
import * as baseNarration from "./narration";
import {
  DEFAULT_VOICE_PROFILE,
  characterVoiceProfileKey,
  mergeVoiceProfiles,
  projectVoiceProfileKey,
  readVoiceProfile,
  sceneVoiceProfileKey,
  type VoiceProfile,
} from "@/lib/voice-profile";
import { runWithVoiceSynthesisContext } from "@/lib/voice-profile-context";

export * from "./narration";

function parseCharacterIds(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * Backward-compatible narration adapter. Existing callers still invoke the
 * original narration engine, while provider synthesis receives the effective
 * project/scene/character voice profile through request-local context.
 */
export async function generateSceneNarration(
  opts: Parameters<typeof baseNarration.generateSceneNarration>[0],
): Promise<Awaited<ReturnType<typeof baseNarration.generateSceneNarration>>> {
  const scene = await db.videoScene.findUnique({
    where: { id: opts.sceneId },
    select: {
      id: true,
      projectId: true,
      characterIds: true,
      narrationLang: true,
      narrationVoice: true,
    },
  });
  if (!scene) throw new Error("Scene not found");

  const [storedProject, storedScene] = await Promise.all([
    readVoiceProfile(projectVoiceProfileKey(scene.projectId)),
    readVoiceProfile(sceneVoiceProfileKey(scene.id)),
  ]);

  let projectProfile = mergeVoiceProfiles(DEFAULT_VOICE_PROFILE, storedProject);
  let sceneProfile = mergeVoiceProfiles(projectProfile, storedScene);

  // Preserve the pre-profile scene settings as explicit legacy overrides.
  if (scene.narrationLang?.trim()) {
    sceneProfile = { ...sceneProfile, language: scene.narrationLang.trim().toLowerCase() };
  }
  const explicitVoice = opts.voice?.trim().toLowerCase();
  const legacyVoice = scene.narrationVoice?.trim().toLowerCase();
  if (explicitVoice) sceneProfile = { ...sceneProfile, voice: explicitVoice };
  else if (legacyVoice) sceneProfile = { ...sceneProfile, voice: legacyVoice };

  const characterIds = parseCharacterIds(scene.characterIds);
  const characters = characterIds.length
    ? await db.character.findMany({
        where: { id: { in: characterIds }, projectId: scene.projectId },
        select: { id: true, voiceId: true },
      })
    : [];

  const byVoice: Record<string, VoiceProfile> = {};
  await Promise.all(characters.map(async (character) => {
    const storedCharacter = await readVoiceProfile(characterVoiceProfileKey(character.id));
    let effective = mergeVoiceProfiles(sceneProfile, storedCharacter);
    const logicalVoice = character.voiceId?.trim().toLowerCase();
    // Existing Character.voiceId remains authoritative unless the new profile
    // explicitly chooses a different voice.
    if (storedCharacter?.voice === "auto" || !storedCharacter?.voice) {
      effective = { ...effective, voice: logicalVoice || sceneProfile.voice };
    }
    if (logicalVoice) byVoice[logicalVoice] = effective;
  }));

  const forwarded = {
    ...opts,
    voice: explicitVoice || legacyVoice || (sceneProfile.voice === "auto" ? undefined : sceneProfile.voice),
    speed: opts.speed ?? sceneProfile.speed,
  };

  return runWithVoiceSynthesisContext(
    { sceneProfile, byVoice },
    () => baseNarration.generateSceneNarration(forwarded),
  );
}
