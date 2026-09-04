import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/project-auth";
import { deductTokensForOperation } from "@/lib/tokens";

/**
 * Return an existing final export to its owner. Downloading does not trigger
 * provider/ffmpeg work, so centralized pricing defines it as a zero-token
 * operation. The idempotent ledger still records the logical download grant.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const projectId = typeof body.projectId === "string" ? body.projectId : "";
    if (!projectId) {
      return NextResponse.json(
        { success: false, error: "Project ID is required" },
        { status: 400 }
      );
    }

    const access = await requireProjectAccess(projectId, false);
    if (!access.ok) return access.response;
    const userId = access.session.userId;
    if (!userId || userId === "guest") {
      return NextResponse.json(
        { success: false, error: "Please sign in to download exported videos" },
        { status: 401 }
      );
    }

    const project = await db.videoProject.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        userId: true,
        title: true,
        finalVideoUrl: true,
      },
    });
    if (!project) {
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 }
      );
    }
    if (project.userId !== userId && access.session.role !== "admin") {
      return NextResponse.json(
        { success: false, error: "Not authorized" },
        { status: 403 }
      );
    }
    if (!project.finalVideoUrl) {
      return NextResponse.json(
        {
          success: false,
          error:
            'This video has not been exported yet. Open it in Studio and choose "Export Video" first.',
        },
        { status: 400 }
      );
    }

    const exportFingerprint = crypto
      .createHash("sha256")
      .update(project.finalVideoUrl, "utf8")
      .digest("hex")
      .slice(0, 24);
    const ledger = await deductTokensForOperation({
      userId,
      operation: "download",
      description: `Download existing export: ${project.title}`,
      referenceId: projectId,
      idempotencyKey: `download:${userId}:${projectId}:${exportFingerprint}`,
    });
    if (!ledger.success) {
      return NextResponse.json(
        { success: false, error: ledger.error || "Failed to prepare download" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      downloadUrl: project.finalVideoUrl,
      projectTitle: project.title,
      tokensSpent: 0,
      remainingTokens: ledger.remainingTokens,
      replayed: ledger.alreadyApplied === true,
      message: "Download ready. Existing exports are free to download.",
    });
  } catch (error) {
    console.error(
      "[download request]",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json(
      { success: false, error: "Failed to process download" },
      { status: 500 }
    );
  }
}
