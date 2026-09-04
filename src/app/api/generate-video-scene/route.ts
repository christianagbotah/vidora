import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { zai, ZAIError } from "@/lib/zai";
import { friendlySceneError } from "@/lib/zai-errors";
import { requireSceneAccess } from "@/lib/project-auth";
import { resolveModelForRequest } from "@/lib/video-models";
import { getEngineChargeInfo } from "@/lib/storefront";
import { PRICING } from "@/lib/pricing";
import { deductTokensForOperation } from "@/lib/tokens";
import {
  saveGeneratedFile,
  publicOrigin,
  toAbsoluteUrl,
} from "@/lib/generated-store";
import { ensureReferenceAspect } from "@/lib/aspect-normalize";
import { autoNarrateScene } from "@/lib/narration";
import {
  buildSceneImagePrompt,
  buildSceneVideoPrompt,
} from "@/lib/image-prompt";

export const runtime = "nodejs";

const VIDEO_SIZE_MAP: Record<string, string> = {
  "16:9": "1920x1080",
  "9:16": "1080x1920",
  "1:1": "1080x1080",
  "4:3": "1440x1080",
  "21:9": "2560x1080",
};

const THUMB_SIZE_MAP: Record<string, string> = {
  "16:9": "1344x768",
  "9:16": "768x1344",
  "1:1": "1024x1024",
  "4:3": "1152x864",
  "21:9": "1440x720",
};

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
    const aspectRatio = project.aspectRatio || "16:9";
    const projectStyle = project.style || null;
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

    const videoPrompt = buildSceneVideoPrompt({
      scenePrompt: prompt,
      characters: project.characters,
      linkedCharacterIds: scene.characterIds,
    });
    const imagePrompt = buildSceneImagePrompt({
      scenePrompt: prompt,
      style: projectStyle,
      characters: project.characters,
      linkedCharacterIds: scene.characterIds,
    });

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
      data: { status: "queued", taskId: null, errorMessage: null },
    });
    await db.videoProject.update({
      where: { id: projectId },
      data: { status: "generating" },
    });

    const videoSize = VIDEO_SIZE_MAP[aspectRatio] || "1920x1080";
    const thumbSize = THUMB_SIZE_MAP[aspectRatio] || "1344x768";
    const origin = publicOrigin(req);

    void runSceneGeneration({
      runId: run.id,
      projectId,
      prompt: videoPrompt,
      imagePrompt,
      sceneId,
      duration,
      videoSize,
      thumbSize,
      needsThumbnail,
      referenceImage,
      origin,
      aspectRatio,
      style: projectStyle,
      videoModel: resolvedModel,
    }).catch(async (err) => {
      console.error(
        "[generate-video-scene] background task crashed:",
        err instanceof Error ? err.message : "unknown error"
      );
      await db.videoScene.update({
        where: { id: sceneId },
        data: {
          status: "failed",
          errorMessage: "An unexpected error occurred during generation.",
        },
      }).catch(() => undefined);
      // The charge is deliberately retained on an ambiguous provider failure.
      // Retrying after a crash must be reconciled rather than silently issuing
      // free provider work after an automatic refund.
      await db.generationRun.update({
        where: { id: run.id },
        data: { status: "needs_reconciliation", error: "Worker crashed during provider operation" },
      }).catch(() => undefined);
    });

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

async function runSceneGeneration(opts: {
  runId: string;
  projectId: string;
  prompt: string;
  imagePrompt: string;
  sceneId: string;
  duration: number;
  videoSize: string;
  thumbSize: string;
  needsThumbnail: boolean;
  referenceImage?: string;
  origin: string;
  aspectRatio: string;
  style?: string | null;
  videoModel: string;
}): Promise<void> {
  const {
    runId,
    projectId,
    prompt,
    imagePrompt,
    sceneId,
    duration,
    videoSize,
    thumbSize,
    needsThumbnail,
    aspectRatio,
    style,
    videoModel,
    origin,
  } = opts;

  let referenceImage: string | undefined;
  if (opts.referenceImage) {
    const normalized = await ensureReferenceAspect(
      opts.referenceImage,
      aspectRatio,
      `scene=${sceneId.slice(0, 8)}`
    );
    referenceImage = toAbsoluteUrl(normalized, origin) ?? undefined;
  }

  let taskId: string;
  try {
    taskId = await zai.generateVideo({
      prompt,
      size: videoSize,
      duration,
      quality: "quality",
      withAudio: true,
      ...(referenceImage ? { imageUrl: referenceImage } : {}),
      model: videoModel,
      aspectRatio,
      ...(style ? { style } : {}),
      retry: { label: "Video generation task", timeoutMs: 120_000, maxRetries: 2 },
    });
  } catch (err) {
    const isRateLimit = err instanceof ZAIError && err.kind === "rate_limit";
    const rawMsg = err instanceof Error ? err.message : String(err);
    const errorMsg = isRateLimit
      ? "Video generation is currently rate-limited. Please wait a few minutes and try again."
      : friendlySceneError(rawMsg);

    await db.videoScene.update({
      where: { id: sceneId },
      data: { status: "failed", errorMessage: errorMsg },
    }).catch(() => undefined);
    await db.generationRun.update({
      where: { id: runId },
      data: {
        status: "needs_reconciliation",
        error: "Provider task creation did not return a task ID",
      },
    }).catch(() => undefined);
    return;
  }

  // Persist provider identity before starting any secondary work. If the web
  // process dies after this point, operations can reconcile the exact task.
  await db.videoScene.update({
    where: { id: sceneId },
    data: { taskId, status: "generating", errorMessage: null },
  });

  if (needsThumbnail) {
    void (async () => {
      try {
        const imageBase64 = await zai.generateImage({
          prompt: imagePrompt,
          size: thumbSize as "1024x1024" | "768x1344" | "864x1152" | "1344x768" | "1152x864" | "1440x720" | "720x1440",
          retry: { label: "Thumbnail generation", timeoutMs: 120_000, maxRetries: 4 },
        });
        const imageUrl = await saveGeneratedFile(
          `thumb_${Date.now()}_${sceneId.slice(0, 8)}.png`,
          Buffer.from(imageBase64, "base64")
        );
        await db.videoScene.update({ where: { id: sceneId }, data: { imageUrl } });
      } catch (imgErr) {
        console.error(
          "Thumbnail generation failed (non-fatal):",
          imgErr instanceof Error ? imgErr.message : "unknown error"
        );
      }
    })();
  }

  const result = await zai.pollVideoTask({
    taskId,
    maxAttempts: 80,
    intervalMs: 15_000,
  });

  if (result.status === "success" && result.videoUrl) {
    await db.videoScene.update({
      where: { id: sceneId },
      data: { videoUrl: result.videoUrl, status: "completed", errorMessage: null },
    });

    const remaining = await db.videoScene.count({
      where: { projectId, videoUrl: null },
    });
    if (remaining === 0) {
      await db.videoProject.update({ where: { id: projectId }, data: { status: "completed" } });
    }
    await db.generationRun.update({
      where: { id: runId },
      data: { status: "completed", activeKey: null, error: null },
    });

    // Auto narration is non-fatal, but it must itself enforce billing before
    // any TTS provider call. The shared narration helper is hardened next.
    void autoNarrateScene(sceneId);
    return;
  }

  if (result.status === "timeout") {
    await db.generationRun.update({
      where: { id: runId },
      data: { status: "waiting_provider", error: null },
    }).catch(() => undefined);
    return;
  }

  const errorMsg = friendlySceneError(
    result.error || "Video generation failed on the server"
  );
  await db.videoScene.update({
    where: { id: sceneId },
    data: { status: "failed", errorMessage: errorMsg },
  }).catch(() => undefined);
  await db.generationRun.update({
    where: { id: runId },
    data: { status: "failed", activeKey: null, error: errorMsg },
  }).catch(() => undefined);
}
