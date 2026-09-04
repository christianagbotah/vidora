import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/project-auth";
import { PRICING } from "@/lib/pricing";

const QUALITY_LABELS: Record<string, string> = {
  draft: "720p Draft",
  standard: "1080p Standard",
  high: "1080p High Quality",
  ultra: "4K Ultra",
};

/**
 * Quote the cost of downloading an already-exported file. Quality selection is
 * an export-time concern; this endpoint does not re-encode media, so download
 * cost must stay aligned with PRICING.download (zero tokens).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const projectId = typeof body.projectId === "string" ? body.projectId : "";
    const qualityKey =
      typeof body.quality === "string" && body.quality
        ? body.quality
        : "standard";

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: "Project ID is required" },
        { status: 400 }
      );
    }
    if (!QUALITY_LABELS[qualityKey]) {
      return NextResponse.json(
        { success: false, error: `Invalid quality: ${qualityKey}` },
        { status: 400 }
      );
    }

    const access = await requireProjectAccess(projectId, false);
    if (!access.ok) return access.response;
    if (!access.session.userId || access.session.userId === "guest") {
      return NextResponse.json(
        { success: false, error: "Please sign in to download exported videos" },
        { status: 401 }
      );
    }

    const project = await db.videoProject.findUnique({
      where: { id: projectId },
      select: {
        userId: true,
        finalVideoUrl: true,
        scenes: {
          where: { videoUrl: { not: null } },
          select: { duration: true },
        },
      },
    });
    if (!project) {
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 }
      );
    }
    if (
      project.userId !== access.session.userId &&
      access.session.role !== "admin"
    ) {
      return NextResponse.json(
        { success: false, error: "Not authorized" },
        { status: 403 }
      );
    }

    const estimatedDuration =
      project.scenes.reduce((sum, scene) => sum + scene.duration, 0) || 0;

    return NextResponse.json({
      success: true,
      tokenCost: PRICING.download.tokens,
      quality: qualityKey,
      qualityLabel: QUALITY_LABELS[qualityKey],
      estimatedDuration,
      sceneCount: project.scenes.length,
      exported: Boolean(project.finalVideoUrl),
      breakdown: {
        qualityBase: 0,
        durationBonus: 0,
        total: PRICING.download.tokens,
      },
      message: project.finalVideoUrl
        ? "Existing exports are free to download."
        : "Export the project first; downloading the resulting export is free.",
    });
  } catch (error) {
    console.error(
      "[calculate download cost]",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json(
      { success: false, error: "Failed to calculate download cost" },
      { status: 500 }
    );
  }
}
