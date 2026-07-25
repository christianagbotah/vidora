import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// ─── Download Request ─────────────────────────────────────────────
// Checks token balance, deducts tokens, returns download URL
// ──────────────────────────────────────────────────────────────────

const QUALITY_TOKEN_COST: Record<string, number> = {
  draft: 1,
  standard: 2,
  high: 4,
  ultra: 8,
};

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const body = await req.json();
    const { projectId, quality = "standard" } = body;

    if (!projectId) {
      return NextResponse.json({ success: false, error: "Project ID is required" }, { status: 400 });
    }

    // Get user with current token balance
    const user = await db.user.findUnique({ where: { email: session.user.email } });
    if (!user) {
      return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
    }

    // Get project
    const project = await db.videoProject.findUnique({
      where: { id: projectId },
      include: {
        scenes: { where: { videoUrl: { not: null } }, orderBy: { sceneNumber: "asc" } },
      },
    });

    if (!project) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }

    if (!project.finalVideoUrl) {
      return NextResponse.json({ success: false, error: "Video has not been exported yet" }, { status: 400 });
    }

    // Calculate token cost
    const qualityBase = QUALITY_TOKEN_COST[quality] || 2;
    const estimatedDuration = project.scenes.reduce((sum, s) => sum + s.duration, 0) || 10;
    let durationBonus = 0;
    if (estimatedDuration > 30) durationBonus = 1;
    if (estimatedDuration > 60) durationBonus = 2;
    if (estimatedDuration > 120) durationBonus = 3;
    if (estimatedDuration > 300) durationBonus = 5;
    const totalTokens = qualityBase + durationBonus;

    // Check if user has enough tokens
    if (user.tokens < totalTokens) {
      return NextResponse.json({
        success: false,
        error: "Insufficient tokens",
        required: totalTokens,
        balance: user.tokens,
        shortfall: totalTokens - user.tokens,
        message: `You need ${totalTokens} tokens but only have ${user.tokens}. Purchase more tokens to download.`,
      });
    }

    // Deduct tokens atomically
    const updatedUser = await db.$transaction(async (tx) => {
      // Deduct tokens
      const u = await tx.user.update({
        where: { id: user.id },
        data: { tokens: { decrement: totalTokens } },
      });

      // Record transaction
      await tx.tokenTransaction.create({
        data: {
          userId: user.id,
          type: "spend",
          amount: -totalTokens,
          description: `Download: ${project.title} (${quality})`,
          referenceId: projectId,
        },
      });

      return u;
    });

    return NextResponse.json({
      success: true,
      downloadUrl: project.finalVideoUrl,
      projectTitle: project.title,
      quality,
      tokensSpent: totalTokens,
      remainingTokens: updatedUser.tokens,
      message: `Download ready! ${totalTokens} tokens deducted. ${updatedUser.tokens} tokens remaining.`,
    });
  } catch (error) {
    console.error("Download request error:", error);
    return NextResponse.json({ success: false, error: "Failed to process download" }, { status: 500 });
  }
}
