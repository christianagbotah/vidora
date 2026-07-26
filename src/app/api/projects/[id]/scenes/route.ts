import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/project-auth";

/**
 * GET /api/projects/[id]/scenes
 * Returns scenes for a project. Owner or admin (view) can access.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await requireProjectAccess(id, false);
    if (!authResult.ok) return authResult.response;

    const scenes = await db.videoScene.findMany({
      where: { projectId: id },
      orderBy: { sceneNumber: "asc" },
    });
    return NextResponse.json({ success: true, scenes });
  } catch (error) {
    console.error("Failed to fetch scenes:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch scenes" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/projects/[id]/scenes
 * Creates a new scene. Only the project owner can add scenes.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await requireProjectAccess(id, true); // write access
    if (!authResult.ok) return authResult.response;

    const body = await req.json();
    const { prompt, enhancedPrompt, duration, transition } = body;

    if (!prompt) {
      return NextResponse.json(
        { success: false, error: "Prompt is required" },
        { status: 400 }
      );
    }

    // Get the next scene number
    const existingScenes = await db.videoScene.findMany({
      where: { projectId: id },
      orderBy: { sceneNumber: "desc" },
      take: 1,
    });
    const nextSceneNumber =
      existingScenes.length > 0 ? existingScenes[0].sceneNumber + 1 : 1;

    const scene = await db.videoScene.create({
      data: {
        projectId: id,
        sceneNumber: nextSceneNumber,
        prompt,
        enhancedPrompt: enhancedPrompt || null,
        duration: duration || 3,
        transition: transition || "fade",
      },
    });

    return NextResponse.json({ success: true, scene }, { status: 201 });
  } catch (error) {
    console.error("Failed to create scene:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create scene" },
      { status: 500 }
    );
  }
}
