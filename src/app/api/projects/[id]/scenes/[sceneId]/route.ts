import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sceneId: string }> }
) {
  try {
    const { sceneId } = await params;
    const body = await req.json();
    const { prompt, enhancedPrompt, duration, transition, status, imageUrl } =
      body;

    const scene = await db.videoScene.update({
      where: { id: sceneId },
      data: {
        ...(prompt !== undefined && { prompt }),
        ...(enhancedPrompt !== undefined && { enhancedPrompt }),
        ...(duration !== undefined && { duration }),
        ...(transition !== undefined && { transition }),
        ...(status !== undefined && { status }),
        ...(imageUrl !== undefined && { imageUrl }),
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

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sceneId: string }> }
) {
  try {
    const { sceneId } = await params;
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
