import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { zai, ZAIError } from "@/lib/zai";
import { zaiErrorResponse, friendlySceneError } from "@/lib/zai-errors";
import { checkTokens, deductTokensForOperation } from "@/lib/tokens";
import { PRICING, calculateProjectCost } from "@/lib/pricing";
import { getEngineChargeInfo } from "@/lib/storefront";
import { saveGeneratedFile, publicOrigin, toAbsoluteUrl } from "@/lib/generated-store";
import { resolveModelForRequest } from "@/lib/video-models";
import { ensureReferenceAspect } from "@/lib/aspect-normalize";
import { autoNarrateScene } from "@/lib/narration";
import { buildSceneImagePrompt, buildSceneVideoPrompt, type CharacterLike } from "@/lib/image-prompt";

export const runtime = "nodejs";

const VIDEO_SIZE_MAP: Record<string, string> = {
  "16:9": "1920x1080", "9:16": "1080x1920", "1:1": "1080x1080", "4:3": "1440x1080", "21:9": "2560x1080",
};
const THUMB_SIZE_MAP: Record<string, string> = {
  "16:9": "1344x768", "9:16": "768x1344", "1:1": "1024x1024", "4:3": "1152x864", "21:9": "1440x720",
};

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function createSceneTask(
  scene: { id: string; sceneNumber: number; prompt: string; enhancedPrompt: string | null; imageUrl?: string | null; referenceImageUrl?: string | null; characterIds?: string | null },
  videoSize: string,
  origin: string,
  ctx: { style: string; characters: CharacterLike[]; aspectRatio: string; videoModel: string | null }
): Promise<string | null> {
  const scenePrompt = scene.enhancedPrompt || scene.prompt;
  let referenceImage: string | undefined;
  if (scene.referenceImageUrl && !scene.referenceImageUrl.startsWith("data:")) {
    referenceImage = scene.referenceImageUrl;
  } else if (scene.characterIds) {
    try {
      const charIds: string[] = JSON.parse(scene.characterIds);
      if (charIds.length) {
        const firstChar = await db.character.findUnique({ where: { id: charIds[0] } });
        if (firstChar?.imageUrl && !firstChar.imageUrl.startsWith("data:")) referenceImage = firstChar.imageUrl;
      }
    } catch { /* malformed legacy characterIds */ }
  }
  if (referenceImage) {
    referenceImage = await ensureReferenceAspect(referenceImage, ctx.aspectRatio, `Scene ${scene.sceneNumber}`);
    referenceImage = toAbsoluteUrl(referenceImage, origin) ?? undefined;
  }

  const videoPrompt = buildSceneVideoPrompt({ scenePrompt, characters: ctx.characters, linkedCharacterIds: scene.characterIds });
  const model = resolveModelForRequest(ctx.videoModel, Boolean(referenceImage));
  const taskId = await zai.generateVideo({
    prompt: videoPrompt,
    size: videoSize,
    duration: 10,
    quality: "quality",
    withAudio: true,
    ...(referenceImage ? { imageUrl: referenceImage } : {}),
    model,
    aspectRatio: ctx.aspectRatio,
    style: ctx.style,
    retry: { label: `Scene ${scene.sceneNumber} video task`, timeoutMs: 120_000, maxRetries: 2 },
  });

  // Persist provider identity before doing anything else. Recovery logic can
  // now distinguish "never submitted" from "already charged/submitted".
  await db.videoScene.update({
    where: { id: scene.id },
    data: { taskId, status: "generating", errorMessage: null },
  });
  return taskId;
}

async function generateMissingThumbnails(
  scenes: { id: string; sceneNumber: number; prompt: string; enhancedPrompt: string | null; characterIds?: string | null; imageUrl?: string | null }[],
  thumbSize: string,
  ctx: { style: string; characters: CharacterLike[] }
): Promise<void> {
  for (const scene of scenes) {
    if (scene.imageUrl) continue;
    try {
      const imagePrompt = buildSceneImagePrompt({
        scenePrompt: scene.enhancedPrompt || scene.prompt,
        style: ctx.style,
        characters: ctx.characters,
        linkedCharacterIds: scene.characterIds,
      });
      const imageBase64 = await zai.generateImage({
        prompt: imagePrompt,
        size: thumbSize as "1024x1024" | "768x1344" | "864x1152" | "1344x768" | "1152x864" | "1440x720" | "720x1440",
        retry: { label: `Scene ${scene.sceneNumber} thumbnail`, timeoutMs: 120_000, maxRetries: 4 },
      });
      const imageUrl = await saveGeneratedFile(`thumb_${Date.now()}_${scene.sceneNumber}.png`, Buffer.from(imageBase64, "base64"));
      await db.videoScene.update({ where: { id: scene.id }, data: { imageUrl } });
    } catch (error) {
      console.error(`Scene ${scene.sceneNumber}: thumbnail failed`, error instanceof Error ? error.message : "unknown error");
    }
  }
}

async function pollTaskUntilDone(taskId: string, sceneId: string, sceneNumber: number): Promise<string | null> {
  const result = await zai.pollVideoTask({ taskId, maxAttempts: 80, intervalMs: 15_000 });
  if (result.status === "success" && result.videoUrl) {
    await db.videoScene.update({ where: { id: sceneId }, data: { videoUrl: result.videoUrl, status: "completed", errorMessage: null } });
    void autoNarrateScene(sceneId);
    return result.videoUrl;
  }
  if (result.status === "timeout") return null;
  const errorMsg = friendlySceneError(result.error || "Video generation task failed on the server");
  await db.videoScene.update({ where: { id: sceneId }, data: { status: "failed", errorMessage: errorMsg } });
  return null;
}

function getErrorInfo(err: unknown): { message: string; isRateLimit: boolean } {
  if (err instanceof ZAIError) {
    return {
      isRateLimit: err.kind === "rate_limit",
      message: err.kind === "rate_limit"
        ? "Video generation is currently rate-limited. Please wait a few minutes and try again."
        : friendlySceneError(err.message),
    };
  }
  return { message: friendlySceneError(err instanceof Error ? err.message : String(err)), isRateLimit: false };
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

    const engineCharge = await getEngineChargeInfo(project.videoModel);
    const tokensPerScene = engineCharge.tokensPerClip + PRICING.image_gen.tokens;
    const costUsdPerScene = engineCharge.costUsdPerClip + PRICING.image_gen.costUsd;
    const totalTokensNeeded = scenesToProcess.length * tokensPerScene;
    const tokenCheck = await checkTokens(userId, totalTokensNeeded);
    if (!tokenCheck.hasEnough) {
      return NextResponse.json({
        success: false,
        error: `Insufficient tokens. You need ${totalTokensNeeded} tokens but have ${tokenCheck.balance}.`,
        tokensNeeded: totalTokensNeeded,
        tokensAvailable: tokenCheck.balance,
        costBreakdown: calculateProjectCost(scenesToProcess.length, { withNarration: false }),
      }, { status: 402 });
    }

    let run;
    try {
      run = await db.generationRun.create({
        data: {
          projectId,
          userId,
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
      customCostUsd: scenesToProcess.length * costUsdPerScene,
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

    const videoSize = VIDEO_SIZE_MAP[project.aspectRatio] || "1920x1080";
    const thumbSize = THUMB_SIZE_MAP[project.aspectRatio] || "1344x768";
    const origin = publicOrigin(req);
    const genCtx = {
      style: project.style || "cinematic",
      characters: (project.characters || []) as CharacterLike[],
      aspectRatio: project.aspectRatio || "16:9",
      videoModel: project.videoModel ?? null,
    };

    for (const scene of scenesToProcess) {
      await db.videoScene.update({ where: { id: scene.id }, data: { status: "queued", taskId: null, errorMessage: null } });
    }

    void (async () => {
      try {
        const taskIds: { sceneId: string; sceneNumber: number; taskId: string }[] = [];
        let hitRateLimit = false;
        for (let i = 0; i < scenesToProcess.length; i++) {
          const scene = scenesToProcess[i];
          try {
            const taskId = await createSceneTask(scene, videoSize, origin, genCtx);
            if (taskId) taskIds.push({ sceneId: scene.id, sceneNumber: scene.sceneNumber, taskId });
          } catch (error) {
            const { message, isRateLimit } = getErrorInfo(error);
            await db.videoScene.update({ where: { id: scene.id }, data: { status: "failed", errorMessage: message } }).catch(() => undefined);
            if (isRateLimit) {
              hitRateLimit = true;
              for (let j = i + 1; j < scenesToProcess.length; j++) {
                await db.videoScene.update({ where: { id: scenesToProcess[j].id }, data: { status: "failed", errorMessage: message } }).catch(() => undefined);
              }
              break;
            }
          }
          if (i < scenesToProcess.length - 1 && !hitRateLimit) await sleep(15_000);
        }

        const thumbnailPromise = generateMissingThumbnails(scenesToProcess, thumbSize, genCtx).catch(() => undefined);
        for (const entry of taskIds) {
          try { await pollTaskUntilDone(entry.taskId, entry.sceneId, entry.sceneNumber); }
          catch (error) {
            const { message } = getErrorInfo(error);
            await db.videoScene.update({ where: { id: entry.sceneId }, data: { status: "failed", errorMessage: message } }).catch(() => undefined);
          }
          await sleep(3_000);
        }
        await thumbnailPromise;

        const allScenes = await db.videoScene.findMany({ where: { projectId } });
        const allDone = allScenes.every((s) => Boolean(s.videoUrl));
        const failed = scenesToProcess.filter((candidate) => {
          const current = allScenes.find((s) => s.id === candidate.id);
          return current?.status === "failed" && !current.videoUrl;
        }).length;
        const stillRunning = allScenes.some((s) => !s.videoUrl && s.status === "generating" && Boolean(s.taskId));

        // Do not automatically refund failed scenes here. A provider task
        // may have been accepted even when submission/polling later failed, and
        // thumbnail generation may already have incurred cost. Uncertain runs
        // stay locked for explicit reconciliation so Vidora never refunds a
        // charge while provider work may still complete.

        if (allDone) {
          await db.videoProject.update({ where: { id: projectId }, data: { status: "completed" } });
          await db.generationRun.update({ where: { id: run.id }, data: { status: "completed", activeKey: null } });
        } else if (stillRunning) {
          // Keep the active key: the provider already has task IDs, so accepting
          // another batch would create duplicate provider work and charges.
          await db.generationRun.update({ where: { id: run.id }, data: { status: "waiting_provider" } });
        } else if (failed > 0) {
          await db.videoProject.update({ where: { id: projectId }, data: { status: "failed" } });
          await db.generationRun.update({
            where: { id: run.id },
            data: {
              status: "needs_reconciliation",
              error: `${failed} scene${failed > 1 ? "s" : ""} failed or had uncertain provider completion`,
            },
          });
        } else {
          await db.generationRun.update({ where: { id: run.id }, data: { status: "completed", activeKey: null } });
        }
      } catch (fatalError) {
        console.error(`Project ${projectId}: generation run ${run.id} crashed`, fatalError instanceof Error ? fatalError.message : "unknown error");
        await db.videoProject.update({ where: { id: projectId }, data: { status: "failed" } }).catch(() => undefined);
        await db.videoScene.updateMany({
          where: { projectId, status: { in: ["generating", "queued"] }, taskId: null },
          data: { status: "failed", errorMessage: "Generation was interrupted before provider submission." },
        }).catch(() => undefined);

        // A missing taskId is not proof that the provider never accepted the
        // request: the process can fail after provider acknowledgement but before
        // the taskId is persisted. Never auto-refund this ambiguous window.
        await db.generationRun.update({
          where: { id: run.id },
          data: {
            status: "needs_reconciliation",
            error: "Generation worker was interrupted; provider completion must be reconciled before refund or retry",
          },
        }).catch(() => undefined);
      }
    })();

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
