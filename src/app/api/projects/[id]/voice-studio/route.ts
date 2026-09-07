import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/project-auth";
import { TTS_VOICES } from "@/lib/narration";
import {
  normalizeVoiceStudioProfile,
  parseVoiceStudioCharacterIds,
  summarizeVoiceStudioScenes,
  voiceStudioProfileForScene,
} from "@/lib/voice-studio";

export const runtime = "nodejs";

type VoiceStudioScope = "project" | "scene" | "character";

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function activeExportResponse(error: unknown): NextResponse | null {
  if (!errorText(error).includes("VIDORA_EXPORT_ACTIVE")) return null;
  return NextResponse.json(
    {
      success: false,
      error: "Voice settings cannot change while an export is queued or running. Wait for the export to finish, then update the voice profile and preview again.",
      code: "VIDORA_EXPORT_ACTIVE",
    },
    { status: 409 },
  );
}

function isKnownVoice(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const requested = value.trim().toLowerCase();
  return TTS_VOICES.some((voice) => voice.id === requested);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await requireProjectAccess(id, false);
    if (!access.ok) return access.response;

    const [scenes, characters] = await Promise.all([
      db.videoScene.findMany({
        where: { projectId: id },
        orderBy: { sceneNumber: "asc" },
        select: {
          id: true,
          sceneNumber: true,
          title: true,
          narrationLang: true,
          narrationAccent: true,
          narrationStyle: true,
          narrationVoice: true,
          narrationUrl: true,
          subtitleLang: true,
          burnSubtitles: true,
        },
      }),
      db.character.findMany({
        where: { projectId: id },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, role: true, voiceId: true, imageUrl: true },
      }),
    ]);

    const summary = summarizeVoiceStudioScenes(scenes);

    return NextResponse.json({
      success: true,
      project: access.project,
      canEdit: access.project.userId !== null && access.project.userId === access.session.userId,
      bulkProfile: summary.profile,
      mixed: summary.mixed,
      voices: TTS_VOICES,
      characters,
      scenes: scenes.map((scene) => ({
        ...scene,
        profile: voiceStudioProfileForScene(scene),
      })),
    });
  } catch (error) {
    console.error("[voice-studio] failed to load project voice settings", error);
    return NextResponse.json(
      { success: false, error: "Failed to load Voice Studio" },
      { status: 500 },
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await requireProjectAccess(id, true);
    if (!access.ok) return access.response;

    const body = await req.json() as Record<string, unknown>;
    const scope = typeof body.scope === "string" ? body.scope as VoiceStudioScope : "project";
    if (!(["project", "scene", "character"] as string[]).includes(scope)) {
      return NextResponse.json({ success: false, error: "Invalid Voice Studio scope" }, { status: 400 });
    }

    if (scope === "character") {
      const characterId = typeof body.scopeId === "string" ? body.scopeId : "";
      if (!characterId) {
        return NextResponse.json({ success: false, error: "Character ID is required" }, { status: 400 });
      }
      const requestedVoice = typeof body.voice === "string" ? body.voice.trim().toLowerCase() : "";
      if (requestedVoice !== "inherit" && requestedVoice !== "auto" && !isKnownVoice(requestedVoice)) {
        return NextResponse.json({ success: false, error: "Unsupported character voice" }, { status: 400 });
      }

      const character = await db.character.findFirst({
        where: { id: characterId, projectId: id },
        select: { id: true, voiceId: true },
      });
      if (!character) {
        return NextResponse.json({ success: false, error: "Character not found in project" }, { status: 404 });
      }

      const nextVoiceId = requestedVoice === "inherit" || requestedVoice === "auto" ? null : requestedVoice;
      if (character.voiceId === nextVoiceId) {
        return NextResponse.json({
          success: true,
          changed: false,
          voiceId: nextVoiceId,
          affectedSceneIds: [] as string[],
        });
      }

      const sceneRefs = await db.videoScene.findMany({
        where: { projectId: id },
        select: { id: true, characterIds: true },
      });
      const affectedSceneIds = sceneRefs
        .filter((scene) => parseVoiceStudioCharacterIds(scene.characterIds).includes(characterId))
        .map((scene) => scene.id);

      await db.$transaction(async (tx) => {
        await tx.character.update({ where: { id: characterId }, data: { voiceId: nextVoiceId } });
        if (affectedSceneIds.length > 0) {
          await tx.videoScene.updateMany({
            where: { id: { in: affectedSceneIds } },
            data: { narrationUrl: null },
          });
        }
      });

      return NextResponse.json({
        success: true,
        changed: true,
        voiceId: nextVoiceId,
        affectedSceneIds,
        narrationInvalidatedScenes: affectedSceneIds.length,
      });
    }

    if (!body.profile || typeof body.profile !== "object" || Array.isArray(body.profile)) {
      return NextResponse.json({ success: false, error: "Narration profile is required" }, { status: 400 });
    }
    const profile = normalizeVoiceStudioProfile(body.profile);

    if (scope === "scene") {
      const sceneId = typeof body.scopeId === "string" ? body.scopeId : "";
      if (!sceneId) {
        return NextResponse.json({ success: false, error: "Scene ID is required" }, { status: 400 });
      }
      const scene = await db.videoScene.findFirst({
        where: { id: sceneId, projectId: id },
        select: {
          id: true,
          narrationLang: true,
          narrationAccent: true,
          narrationStyle: true,
          narrationVoice: true,
          subtitleLang: true,
          burnSubtitles: true,
        },
      });
      if (!scene) {
        return NextResponse.json({ success: false, error: "Scene not found in project" }, { status: 404 });
      }

      const current = voiceStudioProfileForScene(scene);
      const changed = current.language !== profile.language ||
        current.accent !== profile.accent ||
        current.style !== profile.style ||
        current.voice !== profile.voice;
      if (!changed) {
        return NextResponse.json({ success: true, changed: false, profile });
      }

      const languageChanged = current.language !== profile.language;
      await db.videoScene.update({
        where: { id: scene.id },
        data: {
          narrationLang: profile.language,
          narrationAccent: profile.accent,
          narrationStyle: profile.style,
          narrationVoice: profile.voice,
          narrationUrl: null,
          ...(languageChanged && scene.burnSubtitles && scene.subtitleLang !== profile.language
            ? { burnSubtitles: false }
            : {}),
        },
      });

      return NextResponse.json({
        success: true,
        changed: true,
        profile,
        staleBurnedSubtitlesDisabled: Boolean(
          languageChanged && scene.burnSubtitles && scene.subtitleLang !== profile.language,
        ),
      });
    }

    const scenes = await db.videoScene.findMany({
      where: { projectId: id },
      orderBy: { sceneNumber: "asc" },
      select: {
        id: true,
        narrationLang: true,
        narrationAccent: true,
        narrationStyle: true,
        narrationVoice: true,
        subtitleLang: true,
        burnSubtitles: true,
      },
    });
    const changedScenes = scenes.filter((scene) => {
      const current = voiceStudioProfileForScene(scene);
      return current.language !== profile.language ||
        current.accent !== profile.accent ||
        current.style !== profile.style ||
        current.voice !== profile.voice;
    });

    if (changedScenes.length === 0) {
      return NextResponse.json({ success: true, changed: false, profile, sceneCount: scenes.length });
    }

    let disabledSubtitleCount = 0;
    await db.$transaction(async (tx) => {
      for (const scene of changedScenes) {
        const current = voiceStudioProfileForScene(scene);
        const disableStaleBurnedSubtitles =
          current.language !== profile.language &&
          scene.burnSubtitles &&
          scene.subtitleLang !== profile.language;
        if (disableStaleBurnedSubtitles) disabledSubtitleCount += 1;

        await tx.videoScene.update({
          where: { id: scene.id },
          data: {
            narrationLang: profile.language,
            narrationAccent: profile.accent,
            narrationStyle: profile.style,
            narrationVoice: profile.voice,
            narrationUrl: null,
            ...(disableStaleBurnedSubtitles ? { burnSubtitles: false } : {}),
          },
        });
      }
    });

    return NextResponse.json({
      success: true,
      changed: true,
      profile,
      sceneCount: scenes.length,
      changedSceneCount: changedScenes.length,
      staleBurnedSubtitlesDisabled: disabledSubtitleCount,
    });
  } catch (error) {
    const guarded = activeExportResponse(error);
    if (guarded) return guarded;
    console.error("[voice-studio] failed to update voice settings", error);
    return NextResponse.json(
      { success: false, error: "Failed to update Voice Studio settings" },
      { status: 500 },
    );
  }
}