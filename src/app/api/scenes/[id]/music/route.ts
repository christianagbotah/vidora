import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSceneAccess } from "@/lib/project-auth";

/**
 * PUT /api/scenes/[id]/music
 * Updates the music settings for a scene.
 *
 * Body: { musicTrackUrl?, musicVolume?, musicMood? }
 *
 * Access:
 *  - Owner: full access
 *  - Admin: view + edit (admin override)
 *  - Guest on demo project (userId === null): allowed so the demo is
 *    fully interactive without sign-up. Writes to a demo project only
 *    affect that guest's ephemeral demo project.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    // Allow writes on guest demo projects; require auth + ownership for real projects.
    const authResult = await requireSceneAccess(id, true);
    if (!authResult.ok) return authResult.response;

    const body = await req.json();
    const { musicTrackUrl, musicVolume, musicMood } = body;

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
