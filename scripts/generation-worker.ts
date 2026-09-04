import { db } from "@/lib/db";
import { zai, ZAIError } from "@/lib/zai";
import { friendlySceneError } from "@/lib/zai-errors";
import { saveGeneratedFile, toAbsoluteUrl } from "@/lib/generated-store";
import { resolveModelForRequest } from "@/lib/video-models";
import { ensureReferenceAspect } from "@/lib/aspect-normalize";
import { autoNarrateScene } from "@/lib/narration";
import {
  buildSceneImagePrompt,
  buildSceneVideoPrompt,
  type CharacterLike,
} from "@/lib/image-prompt";

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

const IDLE_MS = Math.max(1_000, Number(process.env.GENERATION_WORKER_IDLE_MS || 3_000));
const SUBMISSION_SPACING_MS = Math.max(0, Number(process.env.GENERATION_SUBMISSION_SPACING_MS || 15_000));
const PROCESSING_STALE_MINUTES = 5;
let stopping = false;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function publicOrigin(): string {
  const value = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
  return value.replace(/\/$/, "");
}

function getErrorInfo(error: unknown): { message: string; rateLimited: boolean } {
  if (error instanceof ZAIError) {
    return {
      rateLimited: error.kind === "rate_limit",
      message: error.kind === "rate_limit"
        ? "Video generation is currently rate-limited. Please try again after provider capacity recovers."
        : friendlySceneError(error.message),
    };
  }
  return {
    rateLimited: false,
    message: friendlySceneError(error instanceof Error ? error.message : String(error)),
  };
}

async function heartbeat(runId: string): Promise<void> {
  await db.generationRun.update({
    where: { id: runId },
    data: { status: "processing" },
  });
}

async function claimRun(): Promise<string | null> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "GenerationRun"
      WHERE "activeKey" IS NOT NULL
        AND (
          "status" IN ('running', 'waiting_provider')
          OR (
            "status" = 'processing'
            AND "updatedAt" < NOW() - (${PROCESSING_STALE_MINUTES} * INTERVAL '1 minute')
          )
        )
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;
    const id = rows[0]?.id;
    if (!id) return null;

    await tx.generationRun.update({
      where: { id },
      data: { status: "processing", error: null },
    });
    return id;
  });
}

async function markReconciliation(runId: string, projectId: string, reason: string): Promise<void> {
  await Promise.all([
    db.generationRun.update({
      where: { id: runId },
      data: { status: "needs_reconciliation", error: reason },
    }),
    db.videoProject.update({
      where: { id: projectId },
      data: { status: "failed" },
    }),
  ]);
}

async function submitSceneTask(opts: {
  runId: string;
  scene: {
    id: string;
    sceneNumber: number;
    prompt: string;
    enhancedPrompt: string | null;
    referenceImageUrl: string | null;
    characterIds: string | null;
    duration: number;
  };
  videoSize: string;
  origin: string;
  ctx: {
    style: string;
    characters: CharacterLike[];
    aspectRatio: string;
    videoModel: string | null;
  };
}): Promise<string> {
  const { runId, scene, videoSize, origin, ctx } = opts;

  // Persist intent BEFORE crossing the provider boundary. If a worker dies
  // after this point but before taskId persistence, the next worker sees
  // "submitting" and fails closed into reconciliation rather than resubmitting.
  await db.videoScene.update({
    where: { id: scene.id },
    data: { status: "submitting", errorMessage: null },
  });
  await heartbeat(runId);

  const scenePrompt = scene.enhancedPrompt || scene.prompt;
  let referenceImage: string | undefined;
  if (scene.referenceImageUrl && !scene.referenceImageUrl.startsWith("data:")) {
    referenceImage = scene.referenceImageUrl;
  } else if (scene.characterIds) {
    try {
      const ids: unknown = JSON.parse(scene.characterIds);
      if (Array.isArray(ids)) {
        const firstId = ids.find((id): id is string => typeof id === "string");
        if (firstId) {
          const character = await db.character.findUnique({ where: { id: firstId } });
          if (character?.imageUrl && !character.imageUrl.startsWith("data:")) {
            referenceImage = character.imageUrl;
          }
        }
      }
    } catch {
      // Malformed legacy characterIds are ignored; text-to-video remains valid.
    }
  }

  if (referenceImage) {
    const normalized = await ensureReferenceAspect(
      referenceImage,
      ctx.aspectRatio,
      `Scene ${scene.sceneNumber}`
    );
    referenceImage = toAbsoluteUrl(normalized, origin) ?? undefined;
  }

  const prompt = buildSceneVideoPrompt({
    scenePrompt,
    characters: ctx.characters,
    linkedCharacterIds: scene.characterIds,
  });
  const model = resolveModelForRequest(ctx.videoModel, Boolean(referenceImage));
  const taskId = await zai.generateVideo({
    prompt,
    size: videoSize,
    duration: Math.max(1, Math.min(30, scene.duration || 10)),
    quality: "quality",
    withAudio: true,
    ...(referenceImage ? { imageUrl: referenceImage } : {}),
    model,
    aspectRatio: ctx.aspectRatio,
    style: ctx.style,
    retry: {
      label: `Scene ${scene.sceneNumber} video task`,
      timeoutMs: 120_000,
      maxRetries: 2,
    },
  });

  await db.videoScene.update({
    where: { id: scene.id },
    data: { taskId, status: "generating", errorMessage: null },
  });
  await heartbeat(runId);
  return taskId;
}

async function ensureThumbnail(opts: {
  runId: string;
  scene: {
    id: string;
    sceneNumber: number;
    prompt: string;
    enhancedPrompt: string | null;
    characterIds: string | null;
    imageUrl: string | null;
  };
  thumbSize: string;
  ctx: { style: string; characters: CharacterLike[] };
}): Promise<boolean> {
  const { runId, scene, thumbSize, ctx } = opts;
  if (scene.imageUrl) return true;
  try {
    const prompt = buildSceneImagePrompt({
      scenePrompt: scene.enhancedPrompt || scene.prompt,
      style: ctx.style,
      characters: ctx.characters,
      linkedCharacterIds: scene.characterIds,
    });
    const base64 = await zai.generateImage({
      prompt,
      size: thumbSize as "1024x1024" | "768x1344" | "864x1152" | "1344x768" | "1152x864" | "1440x720" | "720x1440",
      retry: {
        label: `Scene ${scene.sceneNumber} thumbnail`,
        timeoutMs: 120_000,
        maxRetries: 4,
      },
    });
    const imageUrl = await saveGeneratedFile(
      `thumb_${Date.now()}_${scene.sceneNumber}.png`,
      Buffer.from(base64, "base64")
    );
    await db.videoScene.update({ where: { id: scene.id }, data: { imageUrl } });
    await heartbeat(runId);
    return true;
  } catch (error) {
    console.error(
      `[generation-worker] thumbnail scene=${scene.id} failed`,
      error instanceof Error ? error.message : "unknown error"
    );
    return false;
  }
}

async function pollSubmittedTask(opts: {
  runId: string;
  sceneId: string;
  taskId: string;
}): Promise<"completed" | "waiting" | "failed"> {
  const result = await zai.pollVideoTask({
    taskId: opts.taskId,
    // Short polling slices make the worker restartable/responsive. A timeout
    // here is not a provider failure; the durable row remains claimable.
    maxAttempts: 4,
    intervalMs: 15_000,
  });

  if (result.status === "success" && result.videoUrl) {
    await db.videoScene.update({
      where: { id: opts.sceneId },
      data: { videoUrl: result.videoUrl, status: "completed", errorMessage: null },
    });
    await heartbeat(opts.runId);
    // Narration has its own shared metered/idempotent provider boundary.
    void autoNarrateScene(opts.sceneId);
    return "completed";
  }
  if (result.status === "timeout") {
    await heartbeat(opts.runId);
    return "waiting";
  }

  await db.videoScene.update({
    where: { id: opts.sceneId },
    data: {
      status: "failed",
      errorMessage: friendlySceneError(result.error || "Video generation failed on the provider"),
    },
  });
  await heartbeat(opts.runId);
  return "failed";
}

async function processRun(runId: string): Promise<void> {
  const run = await db.generationRun.findUnique({ where: { id: runId } });
  if (!run || !run.activeKey) return;

  const project = await db.videoProject.findUnique({
    where: { id: run.projectId },
    include: {
      scenes: { orderBy: { sceneNumber: "asc" } },
      characters: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!project || !project.userId || project.userId !== run.userId) {
    await markReconciliation(run.id, run.projectId, "Generation run ownership/project state is inconsistent");
    return;
  }

  const runScenes = run.targetSceneId
    ? project.scenes.filter((scene) => scene.id === run.targetSceneId)
    : project.scenes;
  if (run.targetSceneId && runScenes.length !== 1) {
    await markReconciliation(run.id, project.id, "Generation run target scene no longer exists");
    return;
  }

  const scenes = runScenes.filter((scene) => !scene.videoUrl);
  if (scenes.length === 0) {
    const incompleteProjectScenes = await db.videoScene.count({
      where: { projectId: project.id, videoUrl: null },
    });
    await Promise.all([
      db.videoProject.update({
        where: { id: project.id },
        data: { status: incompleteProjectScenes === 0 ? "completed" : "generating" },
      }),
      db.generationRun.update({
        where: { id: run.id },
        data: { status: "completed", activeKey: null, error: null },
      }),
    ]);
    return;
  }

  const ambiguous = scenes.find((scene) => scene.status === "submitting" && !scene.taskId);
  if (ambiguous) {
    await markReconciliation(
      run.id,
      project.id,
      `Scene ${ambiguous.sceneNumber} was interrupted during provider submission; do not resubmit automatically`
    );
    return;
  }

  const aspectRatio = project.aspectRatio || "16:9";
  const videoSize = VIDEO_SIZE_MAP[aspectRatio] || "1920x1080";
  const thumbSize = THUMB_SIZE_MAP[aspectRatio] || "1344x768";
  const ctx = {
    style: project.style || "cinematic",
    characters: (project.characters || []) as CharacterLike[],
    aspectRatio,
    videoModel: project.videoModel ?? null,
  };
  const origin = publicOrigin();

  const queued = scenes.filter((scene) => scene.status === "queued" && !scene.taskId);
  for (let index = 0; index < queued.length; index += 1) {
    const scene = queued[index];
    try {
      await submitSceneTask({ runId: run.id, scene, videoSize, origin, ctx });
    } catch (error) {
      const info = getErrorInfo(error);
      await db.videoScene.update({
        where: { id: scene.id },
        data: { status: "failed", errorMessage: info.message },
      }).catch(() => undefined);
      await markReconciliation(
        run.id,
        project.id,
        `Scene ${scene.sceneNumber} provider submission failed or is ambiguous${info.rateLimited ? " (rate limited)" : ""}`
      );
      return;
    }
    if (index < queued.length - 1 && SUBMISSION_SPACING_MS > 0) {
      await sleep(SUBMISSION_SPACING_MS);
    }
  }

  const scopedSceneWhere = run.targetSceneId
    ? { projectId: project.id, id: run.targetSceneId }
    : { projectId: project.id };
  const afterSubmission = await db.videoScene.findMany({
    where: scopedSceneWhere,
    orderBy: { sceneNumber: "asc" },
  });
  let thumbnailFailure = false;
  for (const scene of afterSubmission.filter((item) => !item.videoUrl && item.taskId)) {
    const ok = await ensureThumbnail({ runId: run.id, scene, thumbSize, ctx });
    if (!ok) thumbnailFailure = true;
  }

  let providerFailure = false;
  let providerWaiting = false;
  for (const scene of afterSubmission.filter((item) => !item.videoUrl && item.taskId)) {
    const state = await pollSubmittedTask({ runId: run.id, sceneId: scene.id, taskId: scene.taskId! });
    if (state === "failed") providerFailure = true;
    if (state === "waiting") providerWaiting = true;
  }

  const finalScenes = await db.videoScene.findMany({ where: scopedSceneWhere });
  const allVideosDone = finalScenes.every((scene) => Boolean(scene.videoUrl));
  if (allVideosDone && !thumbnailFailure) {
    const incompleteProjectScenes = await db.videoScene.count({
      where: { projectId: project.id, videoUrl: null },
    });
    await Promise.all([
      db.videoProject.update({
        where: { id: project.id },
        data: { status: incompleteProjectScenes === 0 ? "completed" : "generating" },
      }),
      db.generationRun.update({
        where: { id: run.id },
        data: { status: "completed", activeKey: null, error: null },
      }),
    ]);
    return;
  }

  if (providerFailure || thumbnailFailure) {
    await markReconciliation(
      run.id,
      project.id,
      providerFailure && thumbnailFailure
        ? "Provider video and thumbnail work require reconciliation"
        : providerFailure
          ? "A submitted provider video task failed and requires reconciliation"
          : "Thumbnail provider work failed and requires reconciliation"
    );
    return;
  }

  if (providerWaiting || finalScenes.some((scene) => !scene.videoUrl && scene.taskId)) {
    await db.generationRun.update({
      where: { id: run.id },
      data: { status: "waiting_provider", error: null },
    });
    return;
  }

  await markReconciliation(run.id, project.id, "Generation run reached an unexpected durable state");
}

async function runForever(): Promise<void> {
  console.log("[generation-worker] started");
  while (!stopping) {
    let runId: string | null = null;
    try {
      runId = await claimRun();
      if (!runId) {
        await sleep(IDLE_MS);
        continue;
      }
      await processRun(runId);
    } catch (error) {
      console.error(
        `[generation-worker] ${runId ? `run=${runId} ` : ""}error`,
        error instanceof Error ? error.message : "unknown error"
      );
      if (runId) {
        const run = await db.generationRun.findUnique({ where: { id: runId } }).catch(() => null);
        if (run) {
          await markReconciliation(
            run.id,
            run.projectId,
            "Generation worker crashed while processing this durable run"
          ).catch(() => undefined);
        }
      }
      await sleep(IDLE_MS);
    }
  }
  await db.$disconnect();
  console.log("[generation-worker] stopped");
}

process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

runForever().catch(async (error) => {
  console.error("[generation-worker] fatal", error);
  await db.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
