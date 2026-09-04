import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/project-auth";
import {
  shareAccessCookieName,
  verifyShareAccessToken,
} from "@/lib/share-access";

/**
 * Owners/admins receive full aggregate analytics. Anonymous share viewers get
 * only the total view count needed by the public player; referers, trends,
 * completion/watch metrics remain private.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const project = await db.videoProject.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        userId: true,
        isPublic: true,
        sharePassword: true,
      },
    });
    if (!project) {
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 }
      );
    }

    let shareViewerAllowed = false;
    if (project.isPublic) {
      if (!project.sharePassword) {
        shareViewerAllowed = true;
      } else {
        const token = req.cookies.get(shareAccessCookieName(project.id))?.value;
        shareViewerAllowed = verifyShareAccessToken(token, project.id);
      }
    }

    const access = await requireProjectAccess(projectId, false);
    const ownerOrAdmin =
      access.ok &&
      access.session.userId !== "guest" &&
      (access.session.userId === project.userId || access.session.role === "admin");

    if (!ownerOrAdmin) {
      if (!shareViewerAllowed && project.userId !== null) {
        return access.ok
          ? NextResponse.json({ success: false, error: "Not authorized" }, { status: 403 })
          : access.response;
      }

      const totalViews = await db.videoView.count({ where: { projectId } });
      return NextResponse.json(
        { success: true, totalViews },
        { headers: { "Cache-Control": "private, no-store, max-age=0" } }
      );
    }

    const views = await db.videoView.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      select: {
        viewerId: true,
        watchDuration: true,
        isComplete: true,
        createdAt: true,
        referer: true,
      },
    });

    const totalViews = views.length;
    const uniqueViewers = new Set(views.map((view) => view.viewerId)).size;
    const totalWatchTime = views.reduce(
      (sum, view) => sum + (view.watchDuration || 0),
      0
    );
    const avgWatchTime =
      totalViews > 0 ? Math.round(totalWatchTime / totalViews) : 0;
    const completions = views.filter((view) => view.isComplete).length;
    const completionRate =
      totalViews > 0 ? Math.round((completions / totalViews) * 100) : 0;

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentViews = views.filter((view) => view.createdAt > sevenDaysAgo);
    const trend: { date: string; views: number }[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      const day = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dayStr = day.toISOString().slice(0, 10);
      const dayViews = recentViews.filter(
        (view) => view.createdAt.toISOString().slice(0, 10) === dayStr
      ).length;
      trend.push({ date: dayStr, views: dayViews });
    }

    const refererCounts: Record<string, number> = {};
    for (const view of views) {
      const ref = view.referer || "Direct";
      let label = ref;
      try {
        if (ref !== "Direct" && ref.startsWith("http")) {
          label = new URL(ref).hostname.replace(/^www\./, "");
        }
      } catch {
        label = ref.slice(0, 50);
      }
      refererCounts[label] = (refererCounts[label] || 0) + 1;
    }
    const topReferers = Object.entries(refererCounts)
      .sort(([, a], [, b]) => b - a)
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
    console.error(
      "[analytics summary GET]",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json(
      { success: false, error: "Failed to load analytics" },
      { status: 500 }
    );
  }
}
