import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * DB-only scene status check.
 * Does NOT call the z-ai API — the backend handles all polling internally.
 * The frontend calls this to see if a scene has completed since last check.
 */
export async function POST(req: NextRequest) {
  try {
    const { sceneId } = await req.json();

    if (!sceneId) {
      return NextResponse.json(
        { success: false, error: "sceneId is required" },
        { status: 400 }
      );
    }

    const scene = await db.videoScene.findUnique({ where: { id: sceneId } });

    if (!scene) {
      return NextResponse.json(
        { success: false, error: "Scene not found" },
        { status: 404 }
      );
    }

    // Return current DB status — no external API calls
    return NextResponse.json({
      success: true,
      status: scene.videoUrl ? "completed" : scene.status,
      videoUrl: scene.videoUrl,
      imageUrl: scene.imageUrl,
      taskId: scene.taskId,
    });
  } catch (error) {
    console.error("Failed to check video status:", error);
    return NextResponse.json(
      { success: false, error: "Failed to check video status" },
      { status: 500 }
    );
  }
}
