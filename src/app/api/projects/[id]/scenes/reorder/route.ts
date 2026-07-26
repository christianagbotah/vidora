import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/project-auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await requireProjectAccess(id, true); // write access
    if (!authResult.ok) return authResult.response;

    const { sceneIds } = await req.json();

    if (!Array.isArray(sceneIds) || sceneIds.length === 0) {
      return NextResponse.json(
        { success: false, error: "sceneIds array is required" },
        { status: 400 }
      );
    }

    // Verify all scenes belong to this project
    const existingScenes = await db.videoScene.findMany({
      where: { projectId: id },
    });

    const existingIds = new Set(existingScenes.map((s) => s.id));
    for (const sid of sceneIds) {
      if (!existingIds.has(sid)) {
        return NextResponse.json(
          { success: false, error: `Scene ${sid} not found in project` },
          { status: 400 }
        );
      }
    }

    // Update sceneNumbers
    for (let i = 0; i < sceneIds.length; i++) {
      await db.videoScene.update({
        where: { id: sceneIds[i] },
        data: { sceneNumber: i + 1 },
      });
    }

    // Fetch updated scenes
    const updatedScenes = await db.videoScene.findMany({
      where: { projectId: id },
      orderBy: { sceneNumber: "asc" },
    });

    return NextResponse.json({ success: true, scenes: updatedScenes });
  } catch (error) {
    console.error("Failed to reorder scenes:", error);
    return NextResponse.json(
      { success: false, error: "Failed to reorder scenes" },
      { status: 500 }
    );
  }
}
