import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { zaiErrorResponse } from "@/lib/zai-errors";
import { checkTokens, deductTokensForOperation } from "@/lib/tokens";
import { PRICING } from "@/lib/pricing";
import { getEngineChargeInfo } from "@/lib/storefront";
import { resolveModelForRequest } from "@/lib/video-models";

export const runtime = "nodejs";

function hasProviderReference(
  scene: { referenceImageUrl: string | null; characterIds: string | null },
  characters: Array<{ id: string; imageUrl: string | null }>
): boolean {
  if (scene.referenceImageUrl && !scene.referenceImageUrl.startsWith("data:")) {
    return true;
  }
  if (!scene.characterIds) return false;
  try {
    const parsed: unknown = JSON.parse(scene.characterIds);
    if (!Array.isArray(parsed)) return false;
    const ids = new Set(parsed.filter((id): id is string => typeof id === "string"));
    return characters.some(
      (character) =>
        ids.has(character.id) &&
        Boolean(character.imageUrl) &&
        !character.imageUrl!.startsWith("data:")
    );
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ success: false, error: "Please sign in to generate videos" }, { status: 401 });
    const userId = (session.user as Record<string, unknown>).id as string;

    const { projectId } = await req.json();
    if (!projectId) return NextResponse.json({ success: false, error: "Project ID is required" }, { status: 400 });

    const project = await db.videoProject.findUnique({
      where: { id: projectId },
      include: { scenes: { orderBy: { sceneNumber: "asc" } }, characters: { orderBy: { createdAt: "asc" } } },
    });
    if (!project) return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    if (!project.userId || project.userId !== userId) {
      return NextResponse.json({ success: false, error: "You don't have access to this project" }, { status: 403 });
    }
    if (!project.scenes.length) return NextResponse.json({ success: false, error: "No scenes in project" }, { status: 400 });

    const activeKey = `project:${projectId}`;
    const existingRun = await db.generationRun.findUnique({ where: { activeKey } });
    if (existingRun) {
      return NextResponse.json({
        success: true,
        message: "Generation already in progress.",
        alreadyRunning: true,
        generationRunId: existingRun.id,
      });
    }

    const QUEUED_STALE_MS = 5 * 60_000;
    const scenesToProcess = project.scenes.filter((s) => !s.videoUrl && (
      s.status === "pending" ||
      (s.status === "queued" && Date.now() - s.updatedAt.getTime() > QUEUED_STALE_MS) ||
      (s.status === "generating" && !s.taskId) ||
      (s.status === "failed" && s.errorMessage?.toLowerCase().includes("rate"))
    ));
    const legacyRunActive = project.scenes.some((s) =>
      (s.status === "generating" && s.taskId) ||
      (s.status === "queued" && !s.videoUrl && Date.now() - s.updatedAt.getTime() <= QUEUED_STALE_MS)
    );

    if (!scenesToProcess.length) {
      if (legacyRunActive) return NextResponse.json({ success: true, message: "Generation already in progress.", sceneCount: 0, alreadyRunning: true });
      await db.videoProject.update({ where: { id: projectId }, data: { status: "completed" } });
      return NextResponse.json({ success: true, message: "All scenes already have videos.", sceneCount: project.scenes.length, alreadyDone: true });
    }

    const sceneCharges = await Promise.all(
      scenesToProcess.map(async (scene) => {
        const resolvedModel = resolveModelForRequest(
          project.videoModel,
          hasProviderReference(scene, project.characters)
        );
        const engineCharge = await getEngineChargeInfo(resolvedModel);
        const needsThumbnail = !scene.imageUrl;
        return {
          sceneId: scene.id,
          model: resolvedModel,
          tokens: engineCharge.tokensPerClip + (needsThumbnail ? PRICING.image_gen.tokens : 0),
          costUsd: engineCharge.costUsdPerClip + (needsThumbnail ? PRICING.image_gen.costUsd : 0),
          needsThumbnail,
        };
      })
    );
    const totalTokensNeeded = sceneCharges.reduce((sum, charge) => sum + charge.tokens, 0);
    const totalCostUsd = sceneCharges.reduce((sum, charge) => sum + charge.costUsd, 0);
    const tokensPerScene = Math.ceil(totalTokensNeeded / scenesToProcess.length);
    const costUsdPerScene = totalCostUsd / scenesToProcess.length;
    const tokenCheck = await checkTokens(userId, totalTokensNeeded);
    if (!tokenCheck.hasEnough) {
      return NextResponse.json({
        success: false,
        error: `Insufficient tokens. You need ${totalTokensNeeded} tokens but have ${tokenCheck.balance}.`,
        tokensNeeded: totalTokensNeeded,
        tokensAvailable: tokenCheck.balance,
        costBreakdown: {
          sceneCount: scenesToProcess.length,
          thumbnailCount: sceneCharges.filter((charge) => charge.needsThumbnail).length,
          totalTokens: totalTokensNeeded,
        },
      }, { status: 402 });
    }

    let run;
    try {
      run = await db.generationRun.create({
        data: {
          projectId,
          userId,
          sceneIds: JSON.stringify(scenesToProcess.map((scene) => scene.id)),
          activeKey,
          status: "queued",
          totalTokens: totalTokensNeeded,
          tokensPerScene,
          costUsdPerScene,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const active = await db.generationRun.findUnique({ where: { activeKey } });
        return NextResponse.json({ success: true, alreadyRunning: true, generationRunId: active?.id, message: "Generation already in progress." });
      }
      throw error;
    }

    const deduction = await deductTokensForOperation({
      userId,
      operation: "video_gen",
      description: `Generate ${scenesToProcess.length} scenes for "${project.title}"`,
      referenceId: projectId,
      idempotencyKey: `generation:${run.id}:charge`,
      customTokens: totalTokensNeeded,
      customCostUsd: totalCostUsd,
    });
    if (!deduction.success) {
      await db.generationRun.update({
        where: { id: run.id },
        data: { status: "failed", activeKey: null, error: deduction.error || "Token charge failed" },
      }).catch(() => undefined);
      return NextResponse.json({ success: false, error: deduction.error || "Failed to process tokens" }, { status: 402 });
    }

    await db.generationRun.update({
      where: { id: run.id },
      data: { status: "running", chargeTransactionId: deduction.transactionId || null },
    });
    await db.videoProject.update({ where: { id: projectId }, data: { status: "generating" } });

    for (const scene of scenesToProcess) {
      await db.videoScene.update({ where: { id: scene.id }, data: { status: "queued", taskId: null, errorMessage: null } });
    }

    // Durable handoff: the PostgreSQL-backed generation worker claims this
    // GenerationRun and performs all provider submission/polling outside the
    // Next.js process. A web restart after this response cannot lose the job.

    return NextResponse.json({
      success: true,
      message: `Generating ${scenesToProcess.length} scene${scenesToProcess.length > 1 ? "s" : ""}.`,
      generationRunId: run.id,
      sceneCount: scenesToProcess.length,
      totalScenes: project.scenes.length,
      tokensCharged: totalTokensNeeded,
      remainingTokens: deduction.remainingTokens,
    });
  } catch (error) {
    const sess = await getServerSession(authOptions).catch(() => null);
    return zaiErrorResponse(error, { session: sess, logLabel: "generate-video" });
  }
}
