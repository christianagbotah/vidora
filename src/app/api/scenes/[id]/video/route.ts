import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSceneAccess } from "@/lib/project-auth";
import { fetchProviderVideo } from "@/lib/provider-video-storage";

export const runtime = "nodejs";

/**
 * Same-origin playback bridge for legacy scenes that still point directly at
 * provider-hosted MP4 URLs. New generation persists clips locally, but this
 * keeps existing projects playable while those clips are migrated.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const authResult = await requireSceneAccess(id, false);
    if (!authResult.ok) return authResult.response;

    const scene = await db.videoScene.findUnique({
      where: { id },
      select: { videoUrl: true },
    });
    if (!scene?.videoUrl) {
      return NextResponse.json({ success: false, error: "Scene video not found" }, { status: 404 });
    }

    if (scene.videoUrl.startsWith("/")) {
      return NextResponse.redirect(new URL(scene.videoUrl, req.url), 307);
    }

    const upstream = await fetchProviderVideo(scene.videoUrl, {
      range: req.headers.get("range"),
      maxAttempts: 2,
    });
    const headers = new Headers();
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set("Cache-Control", "private, no-store, max-age=0");
    headers.set("Pragma", "no-cache");
    headers.set("Content-Disposition", "inline");
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    console.error("[scene video proxy]", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json(
      { success: false, error: "The original provider video is temporarily unavailable. Rebuild the scene if this persists." },
      { status: 502 },
    );
  }
}
