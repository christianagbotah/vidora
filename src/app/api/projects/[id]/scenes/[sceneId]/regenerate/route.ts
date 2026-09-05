import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/project-auth";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sceneId: string }> },
) {
  try {
    const { id, sceneId } = await params;
    const access = await requireProjectAccess(id, true);
    if (!access.ok) return access.response;

    const { prompt, characterId } = await req.json();
    if (typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json({ success: false, error: "A correction prompt is required" }, { status: 400 });
    }

    const activeRun = await db.generationRun.findUnique({ where: { activeKey: `project:${id}` } });
    if (activeRun) {
      return NextResponse.json({
        success: false,
        error: "Finish or resume the current generation run before replacing a completed scene.",
      }, { status: 409 });
    }

    const scene = await db.videoScene.findFirst({ where: { id: sceneId, projectId: id } });
    if (!scene) {
      return NextResponse.json({ success: false, error: "Scene not found" }, { status: 404 });
    }

    let selectedCharacter: { id: string; name: string; imageUrl: string | null } | null = null;
    if (characterId) {
      selectedCharacter = await db.character.findFirst({
        where: { id: characterId, projectId: id },
        select: { id: true, name: true, imageUrl: true },
      });
      if (!selectedCharacter) {
        return NextResponse.json({ success: false, error: "Selected character is not part of this project" }, { status: 400 });
      }
      if (!selectedCharacter.imageUrl) {
        return NextResponse.json({ success: false, error: "The selected character does not have an uploaded/generated reference image" }, { status: 400 });
      }
    }

    const updated = await db.$transaction(async (tx) => {
      const nextScene = await tx.videoScene.update({
        where: { id: sceneId },
        data: {
          prompt: prompt.trim(),
          enhancedPrompt: null,
          ...(selectedCharacter ? {
            characterIds: JSON.stringify([selectedCharacter.id]),
            referenceImageUrl: selectedCharacter.imageUrl,
          } : {}),
          previousVideoUrl: scene.videoUrl || scene.previousVideoUrl || null,
          videoUrl: null,
          taskId: null,
          status: "pending",
          errorMessage: null,
        },
      });
      await tx.videoProject.update({
        where: { id },
        data: { finalVideoUrl: null, status: "draft" },
      });
      return nextScene;
    });

    return NextResponse.json({
      success: true,
      scene: updated,
      referenceCharacter: selectedCharacter,
      previousClipPreserved: Boolean(updated.previousVideoUrl),
    });
  } catch (error) {
    console.error("[scene-regenerate] failed", error);
    return NextResponse.json({ success: false, error: "Failed to prepare scene regeneration" }, { status: 500 });
  }
}
