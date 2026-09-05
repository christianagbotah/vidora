import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/project-auth";
import {
  LOGICAL_VOICES,
  VOICE_ACCENTS,
  VOICE_LANGUAGES,
  VOICE_STYLES,
  characterVoiceProfileKey,
  deleteVoiceProfile,
  projectVoiceProfileKey,
  readVoiceProfile,
  sceneVoiceProfileKey,
  writeVoiceProfile,
} from "@/lib/voice-profile";

export const runtime = "nodejs";

type Scope = "project" | "character" | "scene";

function parseCharacterIds(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function profileKey(scope: Scope, projectId: string, scopeId?: string): string {
  if (scope === "project") return projectVoiceProfileKey(projectId);
  if (!scopeId) throw new Error(`${scope} scope requires scopeId`);
  return scope === "character" ? characterVoiceProfileKey(scopeId) : sceneVoiceProfileKey(scopeId);
}

async function verifyScope(projectId: string, scope: Scope, scopeId?: string) {
  if (scope === "project") return { ok: true as const };
  if (!scopeId) return { ok: false as const, error: "scopeId is required" };
  if (scope === "character") {
    const character = await db.character.findFirst({ where: { id: scopeId, projectId }, select: { id: true } });
    return character ? { ok: true as const } : { ok: false as const, error: "Character not found in project" };
  }
  const scene = await db.videoScene.findFirst({ where: { id: scopeId, projectId }, select: { id: true } });
  return scene ? { ok: true as const } : { ok: false as const, error: "Scene not found in project" };
}

async function invalidateNarration(projectId: string, scope: Scope, scopeId?: string) {
  let sceneIds: string[] = [];
  if (scope === "project") {
    const scenes = await db.videoScene.findMany({ where: { projectId }, select: { id: true } });
    sceneIds = scenes.map((scene) => scene.id);
  } else if (scope === "scene" && scopeId) {
    sceneIds = [scopeId];
  } else if (scope === "character" && scopeId) {
    const scenes = await db.videoScene.findMany({
      where: { projectId },
      select: { id: true, characterIds: true },
    });
    sceneIds = scenes
      .filter((scene) => parseCharacterIds(scene.characterIds).includes(scopeId))
      .map((scene) => scene.id);
  }

  await db.$transaction([
    ...(sceneIds.length
      ? [db.videoScene.updateMany({ where: { id: { in: sceneIds } }, data: { narrationUrl: null } })]
      : []),
    db.videoProject.update({
      where: { id: projectId },
      data: {
        cutVersion: { increment: 1 },
        reviewedCutVersion: null,
        reviewedAt: null,
      },
    }),
  ]);
}

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await requireProjectAccess(id, false);
  if (!access.ok) return access.response;

  const [projectProfile, characters, scenes] = await Promise.all([
    readVoiceProfile(projectVoiceProfileKey(id)),
    db.character.findMany({
      where: { projectId: id },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, role: true, voiceId: true },
    }),
    db.videoScene.findMany({
      where: { projectId: id },
      orderBy: { sceneNumber: "asc" },
      select: { id: true, sceneNumber: true, title: true, narrationLang: true, narrationVoice: true },
    }),
  ]);

  const characterProfiles = Object.fromEntries(await Promise.all(
    characters.map(async (character) => [
      character.id,
      await readVoiceProfile(characterVoiceProfileKey(character.id)),
    ]),
  ));
  const sceneProfiles = Object.fromEntries(await Promise.all(
    scenes.map(async (scene) => [
      scene.id,
      await readVoiceProfile(sceneVoiceProfileKey(scene.id)),
    ]),
  ));

  return NextResponse.json({
    success: true,
    project: access.project,
    projectProfile,
    characters,
    characterProfiles,
    scenes,
    sceneProfiles,
    catalog: {
      languages: VOICE_LANGUAGES,
      accents: VOICE_ACCENTS,
      voices: LOGICAL_VOICES,
      styles: VOICE_STYLES,
    },
    capabilities: {
      language: "Language is enforced when supported by the selected provider; otherwise the spoken text determines language.",
      accent: "Accent precision requires an accent-trained provider voice. ElevenLabs mappings can target language/accent combinations.",
    },
  });
}

export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await requireProjectAccess(id, true);
  if (!access.ok) return access.response;

  const body = await req.json() as Record<string, unknown>;
  const scope = String(body.scope || "project") as Scope;
  if (!(["project", "character", "scene"] as string[]).includes(scope)) {
    return NextResponse.json({ success: false, error: "Invalid voice profile scope" }, { status: 400 });
  }
  const scopeId = typeof body.scopeId === "string" ? body.scopeId : undefined;
  const verified = await verifyScope(id, scope, scopeId);
  if (!verified.ok) return NextResponse.json({ success: false, error: verified.error }, { status: 404 });

  const key = profileKey(scope, id, scopeId);
  const profile = await writeVoiceProfile(
    key,
    body.profile,
    `Vidora ${scope} narration voice profile`,
  );
  await invalidateNarration(id, scope, scopeId);
  return NextResponse.json({ success: true, scope, scopeId: scopeId ?? null, profile });
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await requireProjectAccess(id, true);
  if (!access.ok) return access.response;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const scope = String(body.scope || "project") as Scope;
  if (!(["project", "character", "scene"] as string[]).includes(scope)) {
    return NextResponse.json({ success: false, error: "Invalid voice profile scope" }, { status: 400 });
  }
  const scopeId = typeof body.scopeId === "string" ? body.scopeId : undefined;
  const verified = await verifyScope(id, scope, scopeId);
  if (!verified.ok) return NextResponse.json({ success: false, error: verified.error }, { status: 404 });

  await deleteVoiceProfile(profileKey(scope, id, scopeId));
  await invalidateNarration(id, scope, scopeId);
  return NextResponse.json({ success: true, scope, scopeId: scopeId ?? null });
}
