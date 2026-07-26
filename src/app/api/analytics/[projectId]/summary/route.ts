import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/project-auth";

/**
 * GET /api/analytics/[projectId]/summary
 * Returns aggregate analytics for a project.
 *
 * Access:
 *  - Owner + Admin: full analytics
 *  - Guest on demo project (userId === null): allowed (demo is interactive)
 *  - Public viewer on a public/shared project (isPublic=true): allowed
 *    so the share page can display a view count.
 *  - Otherwise: 403
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;

    // Look up the project to check visibility
    const project = await db.videoProject.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true, isPublic: true },
    });
    if (!project) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }

    // Public projects and guest demo projects can be viewed by anyone.
    // Private projects require owner/admin access.
    const isPubliclyVisible = project.isPublic || project.userId === null;
    if (!isPubliclyVisible) {
      const authResult = await requireProjectAccess(projectId, false);
      if (!authResult.ok) return authResult.response;
    }

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
      // Shorten long referer URLs to just the hostname for readability
      let label = ref;
      try {
        if (ref !== "Direct" && ref.startsWith("http")) {
          label = new URL(ref).hostname.replace(/^www\./, "");
        }
      } catch {
        label = ref.slice(0, 50);
      }
      refererCounts[label] = (refererCounts[label] || 0) + 1;
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
