import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// ─── Token Cost Calculator ────────────────────────────────────────
// Based on video quality and duration
// ───────────────────────────────────────────────────────────────────

const QUALITY_TOKEN_COST: Record<string, { base: number; label: string }> = {
  draft:    { base: 1,  label: "720p Draft" },
  standard: { base: 2,  label: "1080p Standard" },
  high:     { base: 4,  label: "1080p High Quality" },
  ultra:    { base: 8,  label: "4K Ultra" },
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, quality } = body;

    if (!projectId) {
      return NextResponse.json({ success: false, error: "Project ID is required" }, { status: 400 });
    }

    const qualityKey = quality || "standard";
    const qualityConfig = QUALITY_TOKEN_COST[qualityKey];
    if (!qualityConfig) {
      return NextResponse.json({ success: false, error: `Invalid quality: ${qualityKey}` }, { status: 400 });
    }

    const project = await db.videoProject.findUnique({
      where: { id: projectId },
      include: {
        scenes: { where: { videoUrl: { not: null } }, orderBy: { sceneNumber: "asc" } },
      },
    });

    if (!project) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }

    const completedScenes = project.scenes;
    const estimatedDuration = completedScenes.reduce((sum, s) => sum + s.duration, 0) || 10;

    // Duration-based token bonus
    let durationBonus = 0;
    if (estimatedDuration > 30) durationBonus = 1;
    if (estimatedDuration > 60) durationBonus = 2;
    if (estimatedDuration > 120) durationBonus = 3;
    if (estimatedDuration > 300) durationBonus = 5;

    const totalTokens = qualityConfig.base + durationBonus;

    return NextResponse.json({
      success: true,
      tokenCost: totalTokens,
      quality: qualityKey,
      qualityLabel: qualityConfig.label,
      estimatedDuration,
      sceneCount: completedScenes.length,
      breakdown: { qualityBase: qualityConfig.base, durationBonus, total: totalTokens },
      message: `This video will cost ${totalTokens} token${totalTokens > 1 ? "s" : ""} to download`,
    });
  } catch (error) {
    console.error("Calculate download cost error:", error);
    return NextResponse.json({ success: false, error: "Failed to calculate token cost" }, { status: 500 });
  }
}
