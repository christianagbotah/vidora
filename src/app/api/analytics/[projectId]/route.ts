import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * POST /api/analytics/[projectId]/view
 * Records a video view or updates watch duration.
 * Body: { viewerId, watchDuration?, isComplete? }
 * Public (no auth) — called from the public share page.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const { viewerId, watchDuration, isComplete } = await req.json();

    if (!viewerId) {
      return NextResponse.json({ success: false, error: "viewerId required" }, { status: 400 });
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

/**
 * GET /api/analytics/[projectId]/summary
 * Returns aggregate analytics for a project.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const views = await db.videoView.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });

    const totalViews = views.length;
    const uniqueViewers = new Set(views.map(v => v.viewerId)).size;
    const totalWatchTime = views.reduce((sum, v) => sum + (v.watchDuration || 0), 0);
    const avgWatchTime = totalViews > 0 ? Math.round(totalWatchTime / totalViews) : 0;
    const completions = views.filter(v => v.isComplete).length;
    const completionRate = totalViews > 0 ? Math.round((completions / totalViews) * 100) : 0;

    // Last 7 days trend
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentViews = views.filter(v => v.createdAt > sevenDaysAgo);
    const trend: { date: string; views: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const day = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dayStr = day.toISOString().slice(0, 10);
      const dayViews = recentViews.filter(v => v.createdAt.toISOString().slice(0, 10) === dayStr).length;
      trend.push({ date: dayStr, views: dayViews });
    }

    // Top referers
    const refererCounts: Record<string, number> = {};
    views.forEach(v => {
      const ref = v.referer || "Direct";
      refererCounts[ref] = (refererCounts[ref] || 0) + 1;
    });
    const topReferers = Object.entries(refererCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([source, count]) => ({ source, count }));

    return NextResponse.json({
      success: true,
      totalViews,
      uniqueViewers,
      totalWatchTime,
      avgWatchTime,
      completions,
      completionRate,
      trend,
      topReferers,
    });
  } catch (error) {
    console.error("[analytics summary GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load analytics" }, { status: 500 });
  }
}
