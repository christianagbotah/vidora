import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * PUT /api/scenes/[id]/music
 * Updates the music settings for a scene.
 * Body: { musicTrackUrl?, musicVolume?, musicMood? }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: "Auth required" }, { status: 401 });
    }
    const { id } = await params;
    const body = await req.json();
    const { musicTrackUrl, musicVolume, musicMood } = body;

    const scene = await db.videoScene.findUnique({ where: { id }, include: { project: true } });
    if (!scene) {
      return NextResponse.json({ success: false, error: "Scene not found" }, { status: 404 });
    }
    // Allow if user owns the project or is admin
    const userId = (session.user as Record<string, unknown>).id as string;
    const role = (session.user as Record<string, unknown>).role as string;
    if (scene.project.userId && scene.project.userId !== userId && role !== "admin") {
      return NextResponse.json({ success: false, error: "Not authorized" }, { status: 403 });
    }

    const data: Record<string, unknown> = {};
    if (musicTrackUrl !== undefined) data.musicTrackUrl = musicTrackUrl || null;
    if (musicVolume !== undefined) data.musicVolume = Math.max(0, Math.min(100, Number(musicVolume)));
    if (musicMood !== undefined) data.musicMood = musicMood || null;

    const updated = await db.videoScene.update({ where: { id }, data });
    return NextResponse.json({ success: true, scene: updated });
  } catch (error) {
    console.error("[scene music PUT]", error);
    return NextResponse.json({ success: false, error: "Failed to update music" }, { status: 500 });
  }
}
