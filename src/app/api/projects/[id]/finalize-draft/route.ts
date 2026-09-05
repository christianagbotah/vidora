import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/project-auth";
import {
  DRAFT_CHARACTER_VOICES,
  normalizedCharacterName,
  sanitizeCreateDraftSnapshot,
} from "@/lib/create-draft-server";

export const runtime = "nodejs";

function imageForCharacter(images: Record<string, string>, name: string): string | null {
  const wanted = normalizedCharacterName(name);
  for (const [imageName, url] of Object.entries(images)) {
    if (normalizedCharacterName(imageName) === wanted) return url;
  }
  return null;
}

/**
 * POST /api/projects/[id]/finalize-draft
 *
 * Turns the resumable Create-page snapshot into first-class Character and
 * VideoScene rows. This is deliberately idempotent: if the client loses the
 * response after materialization, retrying returns the already-materialized
 * project instead of creating a duplicate project.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await requireProjectAccess(id, true);
    if (!access.ok) return access.response;

    const existingProject = await db.videoProject.findUnique({
      where: { id },
      include: {
        scenes: { orderBy: { sceneNumber: "asc" } },
        characters: { orderBy: { createdAt: "asc" } },
        generationRuns: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    if (!existingProject) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }

    // A previous finalize may have succeeded while its HTTP response was lost.
    // Once draftData is cleared, existing scenes are authoritative.
    if (!existingProject.draftData) {
      if (existingProject.scenes.length > 0) {
        return NextResponse.json({ success: true, project: existingProject, resumed: true });
      }
      return NextResponse.json({ success: false, error: "No resumable draft data found" }, { status: 409 });
    }

    // Never replace scenes after generation has started. Autosave drafts are
    // expected to have no materialized scenes until this endpoint is called.
    const hasGenerationState = existingProject.scenes.some(
      (scene) => !!scene.videoUrl || !!scene.taskId || scene.status === "generating" || scene.status === "queued",
    ) || existingProject.generationRuns.some(
      (run) => run.status === "queued" || run.status === "running" || !!run.chargeTransactionId,
    );
    if (hasGenerationState) {
      return NextResponse.json(
        { success: false, error: "Generation has already started for this project" },
        { status: 409 },
      );
    }

    let rawSnapshot: unknown;
    try {
      rawSnapshot = JSON.parse(existingProject.draftData);
    } catch {
      return NextResponse.json({ success: false, error: "Saved draft data is invalid" }, { status: 409 });
    }
    const snapshot = sanitizeCreateDraftSnapshot(rawSnapshot);

    const rawIdea = snapshot.inputMode === "script"
      ? snapshot.scriptText
      : (snapshot.enhancedText || snapshot.textPrompt || snapshot.scriptText);
    const scenesToCreate = snapshot.parsedScenes.length > 0
      ? snapshot.parsedScenes
      : rawIdea.trim()
        ? [{
            prompt: rawIdea.trim(),
            title: existingProject.title || null,
            dialogue: null,
            visualNote: null,
            characterNames: undefined,
          }]
        : [];

    if (scenesToCreate.length === 0) {
      return NextResponse.json(
        { success: false, error: "Add a script, prompt, or analyzed scene before generating" },
        { status: 400 },
      );
    }

    await db.$transaction(async (tx) => {
      // Reconcile characters by normalized name. Autosave already creates
      // these rows; finalization removes any characters deleted in the wizard.
      const currentCharacters = await tx.character.findMany({
        where: { projectId: id },
        orderBy: { createdAt: "asc" },
      });
      const byName = new Map(
        currentCharacters.map((character) => [normalizedCharacterName(character.name), character]),
      );
      const usedVoiceIds = new Set(
        currentCharacters.map((character) => character.voiceId).filter((voice): voice is string => !!voice),
      );
      const desiredIds: string[] = [];

      for (let index = 0; index < snapshot.parsedCharacters.length; index++) {
        const character = snapshot.parsedCharacters[index];
        const key = normalizedCharacterName(character.name);
        const current = byName.get(key);
        const persistedImage = imageForCharacter(snapshot.preCharImages, character.name);
        if (current) {
          const updated = await tx.character.update({
            where: { id: current.id },
            data: {
              name: character.name,
              role: character.role || "supporting",
              description: character.description || null,
              stylePrompt: character.stylePrompt || null,
              ...(persistedImage ? { imageUrl: persistedImage } : {}),
              updatedAt: new Date(),
            },
          });
          desiredIds.push(updated.id);
          continue;
        }

        const isNarrator = /narrator/i.test(character.name) || character.role.toLowerCase() === "narrator";
        let voiceId = isNarrator ? "tongtong" : null;
        if (!voiceId) {
          voiceId = DRAFT_CHARACTER_VOICES.find((voice) => !usedVoiceIds.has(voice))
            || DRAFT_CHARACTER_VOICES[index % DRAFT_CHARACTER_VOICES.length];
        }
        usedVoiceIds.add(voiceId);
        const created = await tx.character.create({
          data: {
            projectId: id,
            name: character.name,
            role: character.role || "supporting",
            description: character.description || null,
            stylePrompt: character.stylePrompt || null,
            voiceId,
            imageUrl: persistedImage,
          },
        });
        desiredIds.push(created.id);
      }

      if (desiredIds.length > 0) {
        await tx.character.deleteMany({ where: { projectId: id, id: { notIn: desiredIds } } });
      } else {
        await tx.character.deleteMany({ where: { projectId: id } });
      }

      const finalCharacters = await tx.character.findMany({ where: { projectId: id } });
      const charIdByName = new Map(
        finalCharacters.map((character) => [normalizedCharacterName(character.name), character.id]),
      );

      // Drafts should not normally contain rows yet, but replacing them makes
      // a retry before generation deterministic and prevents duplicate scenes.
      await tx.videoScene.deleteMany({ where: { projectId: id } });

      const duration = Math.max(1, Math.floor(existingProject.targetDuration / scenesToCreate.length));
      for (let index = 0; index < scenesToCreate.length; index++) {
        const scene = scenesToCreate[index];
        const linkedIds = (scene.characterNames || [])
          .map((name) => charIdByName.get(normalizedCharacterName(name)))
          .filter((characterId): characterId is string => !!characterId);

        await tx.videoScene.create({
          data: {
            projectId: id,
            sceneNumber: index + 1,
            prompt: scene.prompt,
            title: scene.title || null,
            dialogue: scene.dialogue || null,
            visualNote: scene.visualNote || null,
            characterIds: linkedIds.length ? JSON.stringify(linkedIds) : null,
            duration,
            transition: "fade",
            musicTrackUrl: snapshot.parsedDefaultMusic?.url || null,
            musicMood: snapshot.parsedDefaultMusic?.mood || null,
          },
        });
      }

      await tx.videoProject.update({
        where: { id },
        data: {
          draftData: null,
          lastAutosavedAt: null,
        },
      });
    });

    const project = await db.videoProject.findUnique({
      where: { id },
      include: {
        scenes: { orderBy: { sceneNumber: "asc" } },
        characters: { orderBy: { createdAt: "asc" } },
      },
    });
    return NextResponse.json({ success: true, project, resumed: false });
  } catch (error) {
    console.error("[project-draft] finalize failed", error);
    return NextResponse.json({ success: false, error: "Failed to finalize project draft" }, { status: 500 });
  }
}
