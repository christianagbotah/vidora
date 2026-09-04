import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireSceneAccess } from "@/lib/project-auth";
import { resolveModelForRequest } from "@/lib/video-models";
import { getEngineChargeInfo } from "@/lib/storefront";
import { PRICING } from "@/lib/pricing";
import { deductTokensForOperation } from "@/lib/tokens";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sceneId = typeof body.sceneId === "string" ? body.sceneId : "";
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!sceneId || !prompt) {
      return NextResponse.json(
        { success: false, error: "Prompt and sceneId are required" },
        { status: 400 }
      );
    }

    // Authorization is anchored to the scene itself. A caller cannot bypass
    // auth by omitting projectId or by pairing a scene with another project.
    const access = await requireSceneAccess(sceneId, true);
    if (!access.ok) return access.response;
    if (body.projectId && String(body.projectId) !== access.scene.projectId) {
      return NextResponse.json(
        { success: false, error: "Scene does not belong to the supplied project" },
        { status: 400 }
      );
    }

    const projectId = access.scene.projectId;
    const userId = access.session.userId;
    if (!userId || userId === "guest") {
      return NextResponse.json(
        { success: false, error: "Please sign in to generate video" },
        { status: 401 }
      );
    }

    const project = await db.videoProject.findUnique({
      where: { id: projectId },
      include: {
        scenes: { where: { id: sceneId }, take: 1 },
        characters: { orderBy: { createdAt: "asc" } },
      },
    });
    const scene = project?.scenes[0];
    if (!project || !scene) {
      return NextResponse.json({ success: false, error: "Scene not found" }, { status: 404 });
    }

    // Do not submit a second provider task while a persisted task is active.
    if (scene.taskId && !scene.videoUrl && scene.status === "generating") {
      return NextResponse.json({
        success: true,
        alreadyRunning: true,
        status: "generating",
        message: "Video generation is already in progress for this scene.",
      });
    }

    const duration = Number.isFinite(Number(body.duration))
      ? Math.max(1, Math.min(30, Math.round(Number(body.duration))))
      : 10;
    const videoModel = project.videoModel ?? null;

    let referenceImage: string | undefined;
    if (scene.referenceImageUrl && !scene.referenceImageUrl.startsWith("data:")) {
      referenceImage = scene.referenceImageUrl;
    } else if (scene.characterIds) {
      try {
        const charIds: string[] = JSON.parse(scene.characterIds);
        const firstChar = project.characters.find((c) => charIds.includes(c.id));
        if (firstChar?.imageUrl && !firstChar.imageUrl.startsWith("data:")) {
          referenceImage = firstChar.imageUrl;
        }
      } catch {
        // Malformed legacy characterIds should not weaken authorization/billing.
      }
    }

    const resolvedModel = resolveModelForRequest(videoModel, Boolean(referenceImage));
    const engineCharge = await getEngineChargeInfo(resolvedModel);
    const needsThumbnail = !scene.imageUrl;
    const tokensToCharge = engineCharge.tokensPerClip + (needsThumbnail ? PRICING.image_gen.tokens : 0);
    const costUsd = engineCharge.costUsdPerClip + (needsThumbnail ? PRICING.image_gen.costUsd : 0);

    // Use the same project-level active key as batch generation. This prevents
    // a batch request and a single-scene request from charging/submitting work
    // concurrently for the same project.
    const activeKey = `project:${projectId}`;
    let run;
    try {
      run = await db.generationRun.create({
        data: {
          projectId,
          userId,
          targetSceneId: sceneId,
          activeKey,
          status: "queued",
          totalTokens: tokensToCharge,
          tokensPerScene: tokensToCharge,
          costUsdPerScene: costUsd,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const active = await db.generationRun.findUnique({ where: { activeKey } });
        return NextResponse.json({
          success: true,
          alreadyRunning: true,
          status: "generating",
          generationRunId: active?.id,
          message: "Generation is already in progress for this project.",
        });
      }
      throw error;
    }

    const deduction = await deductTokensForOperation({
      userId,
      operation: "video_gen",
      description: `Generate scene ${scene.sceneNumber} for \"${project.title}\"`,
      referenceId: sceneId,
      idempotencyKey: `generation:${run.id}:charge`,
      customTokens: tokensToCharge,
      customCostUsd: costUsd,
    });
    if (!deduction.success) {
      await db.generationRun.update({
        where: { id: run.id },
        data: { status: "failed", activeKey: null, error: deduction.error || "Token charge failed" },
      }).catch(() => undefined);
      return NextResponse.json(
        { success: false, error: deduction.error || "Insufficient tokens" },
        { status: 402 }
      );
    }

    await db.generationRun.update({
      where: { id: run.id },
      data: { status: "running", chargeTransactionId: deduction.transactionId || null },
    });
    await db.videoScene.update({
      where: { id: sceneId },
      data: {
        enhancedPrompt: prompt,
        duration,
        status: "queued",
        taskId: null,
        errorMessage: null,
      },
    });
    await db.videoProject.update({
      where: { id: projectId },
      data: { status: "generating" },
    });


    // Durable handoff: the shared generation worker owns all provider work.
    // No video/image provider call occurs inside this Next.js request process.
    return NextResponse.json({
      success: true,
      status: "generating",
      generationRunId: run.id,
      tokensCharged: tokensToCharge,
      remainingTokens: deduction.remainingTokens,
      message: "Video generation started. This may take a few minutes.",
    });
  } catch (error) {
    console.error(
      "generate-video-scene:",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json(
      { success: false, error: "Failed to start generation" },
      { status: 500 }
    );
  }
}

