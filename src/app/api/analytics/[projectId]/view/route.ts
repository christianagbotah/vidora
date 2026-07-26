import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * POST /api/analytics/[projectId]/view
 * Records a video view or updates watch duration.
 * Body: { viewerId, watchDuration?, isComplete? }
 *
 * Public (no auth) — called from the public share page to track views.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const body = await req.json().catch(() => ({}));
    const { viewerId, watchDuration, isComplete } = body;

    if (!viewerId) {
      return NextResponse.json({ success: false, error: "viewerId required" }, { status: 400 });
    }

    // Verify the project exists (don't record views for non-existent projects)
    const project = await db.videoProject.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }

    // Find the most recent view from this viewer for this project (within last 30 min)
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    const recent = await db.videoView.findFirst({
      where: {
        projectId,
        viewerId,
        createdAt: { gt: thirtyMinAgo },
      },
      orderBy: { createdAt: "desc" },
    });

    if (recent) {
      // Update existing view
      await db.videoView.update({
        where: { id: recent.id },
        data: {
          watchDuration: (recent.watchDuration || 0) + (watchDuration || 0),
          isComplete: isComplete || recent.isComplete,
        },
      });
    } else {
      // Create new view
      const forwarded = req.headers.get("x-forwarded-for");
      const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown";
      const ua = req.headers.get("user-agent") || "";
      const referer = req.headers.get("referer") || "";

      await db.videoView.create({
        data: {
          projectId,
          viewerId,
          ipAddress: ip,
          userAgent: ua.slice(0, 500),
          referer: referer.slice(0, 500),
          watchDuration: watchDuration || 0,
          isComplete: isComplete || false,
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[analytics view POST]", error);
    return NextResponse.json({ success: false, error: "Failed to record view" }, { status: 500 });
  }
}
