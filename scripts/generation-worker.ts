import { db } from "@/lib/db";
import { zai, ZAIError } from "@/lib/zai";
import { friendlySceneError } from "@/lib/zai-errors";
import { saveGeneratedFile } from "@/lib/generated-store";
import { persistProviderVideo } from "@/lib/provider-video-storage";
import { toProviderFetchUrl } from "@/lib/provider-media-access";
import { resolveModelForRequest } from "@/lib/video-models";
import { ensureReferenceAspect } from "@/lib/aspect-normalize";
import { autoNarrateScene } from "@/lib/narration";
import {
  captureReservedQuoteLine,
  releaseReservationRemainder,
} from "@/lib/credit-reservations";
import { getGenerationRunBillingLink } from "@/lib/generation-run-billing";
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

interface RunBillingContext {
  userId: string;
  projectId: string;
  reservationId: string;
}

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
  billing: RunBillingContext;
}): Promise<string> {
  const { runId, scene, videoSize, origin, ctx, billing } = opts;

  // Persist ambiguous-submission intent before doing anything irreversible.
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
        const linkedIds = ids.filter((id): id is string => typeof id === "string");
        if (linkedIds.length > 0) {
          const linkedCharacters = await db.character.findMany({
            where: { id: { in: linkedIds } },
            select: { id: true, role: true, imageUrl: true },
          });
          const byId = new Map(linkedCharacters.map((character) => [character.id, character]));
          const ordered = linkedIds
            .map((id) => byId.get(id))
            .filter((character) => Boolean(character?.imageUrl))
            .sort((a, b) => {
              const priority = (role?: string | null) => /protagonist|primary|main|subject/i.test(role || "") ? 1 : 0;
              return priority(b?.role) - priority(a?.role);
            });
          const character = ordered[0];
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
      `Scene ${scene.sceneNumber}`,
    );
    referenceImage = toProviderFetchUrl(normalized, origin) ?? undefined;
  }

  const prompt = buildSceneVideoPrompt({
    scenePrompt,
    characters: ctx.characters,
    linkedCharacterIds: scene.characterIds,
  });
  const model = resolveModelForRequest(ctx.videoModel, Boolean(referenceImage));

  // Capture the already-reserved commercial line BEFORE the paid submission.
  // If the process dies after this point but before taskId persistence, the
  // scene remains `submitting` and a later worker fails closed instead of
  // spending against the provider a second time.
  await captureReservedQuoteLine({
    reservationId: billing.reservationId,
    lineKey: `video:${scene.id}`,
    userId: billing.userId,
    projectId: billing.projectId,
    sceneId: scene.id,
    generationRunId: runId,
  });

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
  billing: RunBillingContext;
}): Promise<boolean> {
  const { runId, scene, thumbSize, ctx, billing } = opts;
  if (scene.imageUrl) return true;
  try {
    const prompt = buildSceneImagePrompt({
      scenePrompt: scene.enhancedPrompt || scene.prompt,
      style: ctx.style,
      characters: ctx.characters,
      linkedCharacterIds: scene.characterIds,
    });

    // Same fail-closed rule as video submission: the provider call is only
    // crossed after its quote line has been funded and captured.
    await captureReservedQuoteLine({
      reservationId: billing.reservationId,
      lineKey: `thumbnail:${scene.id}`,
      userId: billing.userId,
      projectId: billing.projectId,
      sceneId: scene.id,
      generationRunId: runId,
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
      Buffer.from(base64, "base64"),
    );
    await db.videoScene.update({ where: { id: scene.id }, data: { imageUrl } });
    await heartbeat(runId);
    return true;
  } catch (error) {
    console.error(
      `[generation-worker] thumbnail scene=${scene.id} failed`,
      error instanceof Error ? error.message : "unknown error",
    );
    return false;
  }
}

async function pollSubmittedTask(opts: {
  runId: string;
  sceneId: string;
  taskId: string;
  billing: RunBillingContext;
}): Promise<"completed" | "waiting" | "failed"> {
  const result = await zai.pollVideoTask({
    taskId: opts.taskId,
    maxAttempts: 4,
    intervalMs: 15_000,
  });

  if (result.status === "success" && result.videoUrl) {
    let localVideoUrl: string;
    try {
      localVideoUrl = await persistProviderVideo(opts.sceneId, result.videoUrl);
    } catch (error) {
      console.warn(
        `[generation-worker] scene=${opts.sceneId} rendered but provider media copy is pending:`,
        error instanceof Error ? error.message : "unknown error",
      );
      await db.videoScene.update({
        where: { id: opts.sceneId },
        data: {
          status: "generating",
          errorMessage: "Video rendered successfully; Vidora is securing the media file locally before completion.",
        },
      });
      await heartbeat(opts.runId);
      return "waiting";
    }

    await db.videoScene.update({
      where: { id: opts.sceneId },
      data: { videoUrl: localVideoUrl, status: "completed", errorMessage: null },
    });
    await heartbeat(opts.runId);

    // Narration is part of the same prepaid quote. Run it synchronously so the
    // GenerationRun cannot release its remaining reservation before speech is
    // either captured or explicitly held for reconciliation.
    const narration = await autoNarrateScene(opts.sceneId, {
      reservationId: opts.billing.reservationId,
      generationRunId: opts.runId,
    });
    if (!narration.ok && narration.reason !== "no dialogue") {
      console.warn(`[generation-worker] prepaid narration pending scene=${opts.sceneId}: ${narration.reason || "unknown"}`);
    }
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

async function finishRunIfComplete(opts: {
  runId: string;
  projectId: string;
  userId: string;
  scopedSceneIds: string[];
  reservationId: string;
}): Promise<boolean> {
  const scoped = await db.videoScene.findMany({
    where: { projectId: opts.projectId, id: { in: opts.scopedSceneIds } },
    select: { id: true, videoUrl: true, dialogue: true, narrationUrl: true },
  });
  if (scoped.some((scene) => !scene.videoUrl)) return false;

  for (const scene of scoped) {
    if (!scene.dialogue?.trim() || scene.narrationUrl) continue;
    const result = await autoNarrateScene(scene.id, {
      reservationId: opts.reservationId,
      generationRunId: opts.runId,
    });
    if (!result.ok) {
      await markReconciliation(
        opts.runId,
        opts.projectId,
        `Video generation completed but prepaid narration for scene ${scene.id} requires reconciliation: ${result.reason || "TTS unavailable"}`,
      );
      return true;
    }
  }

  await releaseReservationRemainder({
    reservationId: opts.reservationId,
    userId: opts.userId,
    reason: `Generation run ${opts.runId} completed; releasing provider work that was not consumed`,
  });

  const incompleteProjectScenes = await db.videoScene.count({
    where: { projectId: opts.projectId, videoUrl: null },
  });
  await Promise.all([
    db.videoProject.update({
      where: { id: opts.projectId },
      data: { status: incompleteProjectScenes === 0 ? "completed" : "generating" },
    }),
    db.generationRun.update({
      where: { id: opts.runId },
      data: { status: "completed", activeKey: null, error: null },
    }),
  ]);
  return true;
}

async function processRun(runId: string): Promise<void> {
  const run = await db.generationRun.findUnique({ where: { id: runId } });
  if (!run || !run.activeKey) return;

  const billingLink = await getGenerationRunBillingLink(run.id);
  if (!billingLink.creditReservationId) {
    await markReconciliation(
      run.id,
      run.projectId,
      "Generation run has no prepaid credit reservation; paid provider execution is blocked",
    );
    return;
  }

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
  const billing: RunBillingContext = {
    userId: run.userId,
    projectId: project.id,
    reservationId: billingLink.creditReservationId,
  };

  let persistedSceneIds: string[] = [];
  try {
    const parsed: unknown = JSON.parse(run.sceneIds || "[]");
    if (Array.isArray(parsed)) {
      persistedSceneIds = parsed.filter((id): id is string => typeof id === "string");
    }
  } catch {
    persistedSceneIds = [];
  }

  const requestedIds = persistedSceneIds.length > 0
    ? persistedSceneIds
    : run.targetSceneId
      ? [run.targetSceneId]
      : [];
  const requestedSet = new Set(requestedIds);
  const runScenes = requestedIds.length > 0
    ? project.scenes.filter((scene) => requestedSet.has(scene.id))
    : project.scenes.filter(
        (scene) =>
          scene.status === "queued" ||
          scene.status === "submitting" ||
          scene.status === "generating" ||
          Boolean(scene.taskId),
      );

  if (requestedIds.length > 0 && runScenes.length !== requestedSet.size) {
    await markReconciliation(run.id, project.id, "Generation run scene scope no longer matches the project");
    return;
  }

  const scopedSceneIds = runScenes.map((scene) => scene.id);
  if (await finishRunIfComplete({
    runId: run.id,
    projectId: project.id,
    userId: run.userId,
    scopedSceneIds,
    reservationId: billing.reservationId,
  })) return;

  const scenes = runScenes.filter((scene) => !scene.videoUrl);
  const ambiguous = scenes.find((scene) => scene.status === "submitting" && !scene.taskId);
  if (ambiguous) {
    await markReconciliation(
      run.id,
      project.id,
      `Scene ${ambiguous.sceneNumber} was interrupted during a funded provider submission; automatic resubmission is blocked`,
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
  const newlySubmittedSceneIds = new Set<string>();
  for (let index = 0; index < queued.length; index += 1) {
    const scene = queued[index];
    try {
      await submitSceneTask({ runId: run.id, scene, videoSize, origin, ctx, billing });
      newlySubmittedSceneIds.add(scene.id);
    } catch (error) {
      const info = getErrorInfo(error);
      await db.videoScene.update({
        where: { id: scene.id },
        data: { status: "failed", errorMessage: info.message },
      }).catch(() => undefined);
      await markReconciliation(
        run.id,
        project.id,
        `Scene ${scene.sceneNumber} funded provider submission failed or is ambiguous${info.rateLimited ? " (rate limited)" : ""}`,
      );
      return;
    }
    if (index < queued.length - 1 && SUBMISSION_SPACING_MS > 0) {
      await sleep(SUBMISSION_SPACING_MS);
    }
  }

  const afterSubmission = await db.videoScene.findMany({
    where: { projectId: project.id, id: { in: scopedSceneIds } },
    orderBy: { sceneNumber: "asc" },
  });
  for (const scene of afterSubmission.filter(
    (item) => newlySubmittedSceneIds.has(item.id) && !item.videoUrl && item.taskId && !item.imageUrl,
  )) {
    await ensureThumbnail({ runId: run.id, scene, thumbSize, ctx, billing });
  }

  let providerFailure = false;
  let providerWaiting = false;
  for (const scene of afterSubmission.filter((item) => !item.videoUrl && item.taskId)) {
    const state = await pollSubmittedTask({
      runId: run.id,
      sceneId: scene.id,
      taskId: scene.taskId!,
      billing,
    });
    if (state === "failed") providerFailure = true;
    if (state === "waiting") providerWaiting = true;
  }

  if (await finishRunIfComplete({
    runId: run.id,
    projectId: project.id,
    userId: run.userId,
    scopedSceneIds,
    reservationId: billing.reservationId,
  })) return;

  if (providerFailure) {
    await markReconciliation(
      run.id,
      project.id,
      "A funded provider video task failed and requires reconciliation",
    );
    return;
  }

  const finalScenes = await db.videoScene.findMany({
    where: { projectId: project.id, id: { in: scopedSceneIds } },
  });
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
        error instanceof Error ? error.message : "unknown error",
      );
      if (runId) {
        const run = await db.generationRun.findUnique({ where: { id: runId } }).catch(() => null);
        if (run) {
          await markReconciliation(
            run.id,
            run.projectId,
            "Generation worker crashed while processing this durable run",
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
