import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/project-auth";

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function activeExportResponse(error: unknown): NextResponse | null {
  if (!errorText(error).includes("VIDORA_EXPORT_ACTIVE")) return null;
  return NextResponse.json(
    {
      success: false,
      error: "This scene cannot be changed while an export is queued or running. Wait for the export to finish, then edit and preview again.",
      code: "VIDORA_EXPORT_ACTIVE",
    },
    { status: 409 },
  );
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * PUT /api/projects/[id]/scenes/[sceneId]
 * Updates a scene. Only the project owner can edit scenes.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sceneId: string }> }
) {
  try {
    const { id, sceneId } = await params;
    const authResult = await requireProjectAccess(id, true); // write access
    if (!authResult.ok) return authResult.response;

    const body = await req.json();
    const {
      prompt, enhancedPrompt, duration, transition, status, imageUrl,
      mood, cameraMove, lighting, narrationVoice, narrationLang,
      title, visualNote, dialogue, characterIds, referenceImageUrl,
      videoUrl, previousVideoUrl,
      // Internal-state resets (scene prompt editor + retry flow): clear the
      // stale error/task so the scene is treated as a fresh pending scene.
      errorMessage, taskId,
    } = body;

    // Verify the scene belongs to this project (prevents ID manipulation) and
    // load the narration source fields so we only invalidate audio on a real
    // semantic change, not a no-op autosave of the same value.
    const existing = await db.videoScene.findFirst({
      where: { id: sceneId, projectId: id },
      select: {
        id: true,
        dialogue: true,
        characterIds: true,
        narrationVoice: true,
        narrationLang: true,
      },
    });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Scene not found in this project" },
        { status: 404 }
      );
    }

    const narrationSourceChanged =
      (dialogue !== undefined && nullableText(dialogue) !== existing.dialogue) ||
      (characterIds !== undefined && nullableText(characterIds) !== existing.characterIds) ||
      (narrationVoice !== undefined && nullableText(narrationVoice) !== existing.narrationVoice) ||
      (narrationLang !== undefined && nullableText(narrationLang) !== existing.narrationLang);

    const scene = await db.videoScene.update({
      where: { id: sceneId },
      data: {
        ...(prompt !== undefined && { prompt }),
        ...(enhancedPrompt !== undefined && { enhancedPrompt }),
        ...(duration !== undefined && { duration }),
        ...(transition !== undefined && { transition }),
        ...(status !== undefined && { status }),
        ...(imageUrl !== undefined && { imageUrl }),
        ...(mood !== undefined && { mood: mood || null }),
        ...(cameraMove !== undefined && { cameraMove: cameraMove || null }),
        ...(narrationVoice !== undefined && { narrationVoice: narrationVoice || null }),
        ...(narrationLang !== undefined && { narrationLang: narrationLang || null }),
        ...(title !== undefined && { title: title || null }),
        ...(visualNote !== undefined && { visualNote: visualNote || null }),
        ...(dialogue !== undefined && { dialogue: dialogue || null }),
        ...(characterIds !== undefined && { characterIds: characterIds || null }),
        ...(referenceImageUrl !== undefined && { referenceImageUrl: referenceImageUrl || null }),
        ...(videoUrl !== undefined && { videoUrl: videoUrl || null }),
        ...(previousVideoUrl !== undefined && { previousVideoUrl: previousVideoUrl || null }),
        // Narration files are deterministic derivatives of dialogue + speaker/
        // voice configuration. Never keep a URL after its source changed.
        ...(narrationSourceChanged && { narrationUrl: null }),
        // Prompt-editor / retry resets — null clears the stale state.
        ...(errorMessage !== undefined && { errorMessage: errorMessage || null }),
        ...(taskId !== undefined && { taskId: taskId || null }),
      },
    });

    const invalidatesAssembly =
      prompt !== undefined || enhancedPrompt !== undefined || characterIds !== undefined ||
      dialogue !== undefined || narrationVoice !== undefined || narrationLang !== undefined ||
      referenceImageUrl !== undefined || videoUrl === null;
    if (invalidatesAssembly) {
      await db.videoProject.update({
        where: { id },
        data: { finalVideoUrl: null, ...(videoUrl === null ? { status: "draft" } : {}) },
      });
    }

    return NextResponse.json({ success: true, scene, narrationInvalidated: narrationSourceChanged });
  } catch (error) {
    const guarded = activeExportResponse(error);
    if (guarded) return guarded;
    console.error("Failed to update scene:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update scene" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/projects/[id]/scenes/[sceneId]
 * Deletes a scene. Only the project owner can delete scenes.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sceneId: string }> }
) {
  try {
    const { id, sceneId } = await params;
    const authResult = await requireProjectAccess(id, true); // write access
    if (!authResult.ok) return authResult.response;

    // Verify the scene belongs to this project
    const existing = await db.videoScene.findFirst({
      where: { id: sceneId, projectId: id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Scene not found in this project" },
        { status: 404 }
      );
    }

    await db.videoScene.delete({ where: { id: sceneId } });
    return NextResponse.json({ success: true, message: "Scene deleted" });
  } catch (error) {
    const guarded = activeExportResponse(error);
    if (guarded) return guarded;
    console.error("Failed to delete scene:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete scene" },
      { status: 500 }
    );
  }
}
