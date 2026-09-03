import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/project-auth";

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
      title, visualNote, dialogue,
      // Internal-state resets (scene prompt editor + retry flow): clear the
      // stale error/task so the scene is treated as a fresh pending scene.
      errorMessage, taskId,
    } = body;

    // Verify the scene belongs to this project (prevents ID manipulation)
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
        ...(lighting !== undefined && { lighting: lighting || null }),
        ...(narrationVoice !== undefined && { narrationVoice: narrationVoice || null }),
        ...(narrationLang !== undefined && { narrationLang: narrationLang || null }),
        ...(title !== undefined && { title: title || null }),
        ...(visualNote !== undefined && { visualNote: visualNote || null }),
        ...(dialogue !== undefined && { dialogue: dialogue || null }),
        // Prompt-editor / retry resets — null clears the stale state.
        ...(errorMessage !== undefined && { errorMessage: errorMessage || null }),
        ...(taskId !== undefined && { taskId: taskId || null }),
      },
    });

    return NextResponse.json({ success: true, scene });
  } catch (error) {
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
    console.error("Failed to delete scene:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete scene" },
      { status: 500 }
    );
  }
}
