import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { zai, ZAIError } from "@/lib/zai";
import { zaiErrorResponse } from "@/lib/zai-errors";
import { checkTokens, deductTokensForOperation, refundTokens } from "@/lib/tokens";
import { PRICING, calculateProjectCost } from "@/lib/pricing";
import { saveGeneratedFile, publicOrigin, toAbsoluteUrl } from "@/lib/generated-store";
import { resolveModelForRequest } from "@/lib/video-models";
import {
  buildSceneImagePrompt,
  buildSceneVideoPrompt,
  type CharacterLike,
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * How long to wait (ms) after a rate-limit error before trying the next scene.
 * The ZAI video API rate limit window is typically 2-5 minutes.
 */
const RATE_LIMIT_COOLDOWN_MS = 120_000; // 2 minutes

async function createSceneTask(
  scene: {
    id: string; sceneNumber: number; prompt: string; enhancedPrompt: string | null;
    imageUrl?: string | null; referenceImageUrl?: string | null; characterIds?: string | null;
  },
  videoSize: string,
  origin: string,
  ctx: { style: string; characters: CharacterLike[]; aspectRatio: string; videoModel: string | null }
): Promise<string | null> {
  const scenePrompt = scene.enhancedPrompt || scene.prompt;

  // NOTE: thumbnails are generated AFTER task creation (in a parallel
  // background pass) — the video task does not depend on them, and
  // generating them inline delayed each task by 30-60s.

  // Determine reference image URL — must be absolute so the ZAI API
  // can fetch it (local /generated/... paths are unreachable).
  let referenceImage: string | undefined;
  if (scene.referenceImageUrl) {
    // Skip base64 data URLs — too large for the API
    if (!scene.referenceImageUrl.startsWith("data:")) {
      referenceImage = toAbsoluteUrl(scene.referenceImageUrl, origin);
    }
  } else if (scene.characterIds) {
    try {
      const charIds: string[] = JSON.parse(scene.characterIds);
      if (charIds.length > 0) {
        const firstChar = await db.character.findUnique({ where: { id: charIds[0] } });
        if (firstChar?.imageUrl && !firstChar.imageUrl.startsWith("data:")) {
          referenceImage = toAbsoluteUrl(firstChar.imageUrl, origin);
        }
      }
    } catch { /* ignore parse errors */ }
  }

  // Character-aware video prompt (≤512 chars): appends a compact digest of
  // the linked/mentioned characters' appearance so the video model knows
  // who is in the frame.
  const videoPrompt = buildSceneVideoPrompt({
    scenePrompt,
    characters: ctx.characters,
    linkedCharacterIds: scene.characterIds,
  });

  // Create video generation task via centralized wrapper.
  // The model is resolved per-scene: image-dependent models gracefully
  // substitute their text-capable sibling when no reference image exists.
  const model = resolveModelForRequest(ctx.videoModel, Boolean(referenceImage));
  const taskId = await zai.generateVideo({
    prompt: videoPrompt,
    size: videoSize,
    duration: 10,
    quality: "quality",
    withAudio: false,
    ...(referenceImage ? { imageUrl: referenceImage } : {}),
    model,
    aspectRatio: ctx.aspectRatio,
    style: ctx.style,
    retry: { label: `Scene ${scene.sceneNumber} video task`, timeoutMs: 120_000, maxRetries: 2 },
  });
  if (model !== (ctx.videoModel ?? "CogVideoX-3")) {
    console.log(`Scene ${scene.sceneNumber}: no reference image — model substituted ${ctx.videoModel ?? "default"} → ${model}`);
  }

  await db.videoScene.update({
    where: { id: scene.id },
    data: { taskId, status: "generating", errorMessage: null },
  });
  console.log(`Scene ${scene.sceneNumber}: video task ${taskId} created`);
  return taskId;
}

/** Generate thumbnails for scenes that are missing one — runs in parallel
 * with the polling phase (non-fatal on failure). Prompts are character-aware:
 * linked/mentioned characters' full appearance descriptions are merged in so
 * the thumbnail matches the described characters. */
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
      const buffer = Buffer.from(imageBase64, "base64");
      const filename = `thumb_${Date.now()}_${scene.sceneNumber}.png`;
      const imageUrl = await saveGeneratedFile(filename, buffer);
      await db.videoScene.update({ where: { id: scene.id }, data: { imageUrl } });
      console.log(`Scene ${scene.sceneNumber}: thumbnail saved`);
    } catch (imgErr) {
      console.error(`Scene ${scene.sceneNumber}: thumbnail failed (non-fatal)`, imgErr);
    }
  }
}

async function pollTaskUntilDone(
  taskId: string,
  sceneId: string,
  sceneNumber: number
): Promise<string | null> {
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
    console.log(`Scene ${scene.sceneNumber}: video ready! URL: ${result.videoUrl.slice(0, 80)}...`);
    return result.videoUrl;
  }

  if (result.status === "timeout") {
    // Timeout — leave in "generating" state so the frontend can keep polling
    console.warn(`Scene ${scene.sceneNumber}: polling timed out, scene left in "generating" state for client polling`);
    return null;
  }

  // Failed
  const errorMsg = result.error || "Video generation task failed on the server";
  console.error(`Scene ${scene.sceneNumber}: task failed. ${errorMsg}`);
  await db.videoScene.update({
    where: { id: sceneId },
    data: { status: "failed", errorMessage: errorMsg },
  });
  return null;
}

/**
 * Extract a user-friendly error message from a ZAIError or generic error.
 */
function getErrorInfo(err: unknown): { message: string; isRateLimit: boolean } {
  if (err instanceof ZAIError) {
    const isRateLimit = err.kind === "rate_limit";
    const message = isRateLimit
      ? "Video generation is currently rate-limited. Please wait a few minutes and try again."
      : err.message;
    return { message, isRateLimit };
  }
  return { message: err instanceof Error ? err.message : String(err), isRateLimit: false };
}

export async function POST(req: NextRequest) {
  try {
    // ── Authentication ──
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: "Please sign in to generate videos" },
        { status: 401 }
      );
    }
    const userId = (session.user as Record<string, unknown>).id as string;

    const { projectId } = await req.json();
    if (!projectId) {
      return NextResponse.json({ success: false, error: "Project ID is required" }, { status: 400 });
    }

    const project = await db.videoProject.findUnique({
      where: { id: projectId },
      include: {
        scenes: { orderBy: { sceneNumber: "asc" } },
        characters: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!project) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }
    // Ensure the user owns this project
    if (project.userId && project.userId !== userId) {
      return NextResponse.json({ success: false, error: "You don't have access to this project" }, { status: 403 });
    }
    if (project.scenes.length === 0) {
      return NextResponse.json({ success: false, error: "No scenes in project" }, { status: 400 });
    }

    // Process pending scenes only (also retry scenes stuck in "generating" with no taskId,
    // and scenes that failed due to rate limits — they can be retried)
    const scenesToProcess = project.scenes.filter(
      (s) => !s.videoUrl && (
        s.status === "pending" ||
        (s.status === "generating" && !s.taskId) ||
        (s.status === "failed" && s.errorMessage?.toLowerCase().includes("rate"))
      )
    );

    if (scenesToProcess.length === 0) {
      const hasGenerating = project.scenes.some((s) => s.status === "generating" && s.taskId);
      if (hasGenerating) {
        return NextResponse.json({
          success: true,
          message: "Generation already in progress.",
          sceneCount: 0,
          alreadyRunning: true,
        });
      }
      await db.videoProject.update({ where: { id: projectId }, data: { status: "completed" } });
      return NextResponse.json({
        success: true,
        message: "All scenes already have videos.",
        sceneCount: project.scenes.length,
        alreadyDone: true,
      });
    }

    // ── Token Check ──
    const tokensPerScene = PRICING.video_gen.tokens + PRICING.image_gen.tokens;
    const totalTokensNeeded = scenesToProcess.length * tokensPerScene;

    const tokenCheck = await checkTokens(userId, totalTokensNeeded);
    if (!tokenCheck.hasEnough) {
      const costBreakdown = calculateProjectCost(scenesToProcess.length, { withNarration: false });
      return NextResponse.json(
        {
          success: false,
          error: `Insufficient tokens. You need ${totalTokensNeeded} tokens to generate ${scenesToProcess.length} scene${scenesToProcess.length > 1 ? "s" : ""}, but you have ${tokenCheck.balance}.`,
          tokensNeeded: totalTokensNeeded,
          tokensAvailable: tokenCheck.balance,
          costBreakdown,
        },
        { status: 402 }
      );
    }

    // ── Deduct Tokens ──
    const deduction = await deductTokensForOperation({
      userId,
      operation: "video_gen",
      description: `Generate ${scenesToProcess.length} scene${scenesToProcess.length > 1 ? "s" : ""} for "${project.title}"`,
      referenceId: projectId,
      customTokens: totalTokensNeeded,
      customCostUsd: scenesToProcess.length * (PRICING.video_gen.costUsd + PRICING.image_gen.costUsd),
    });

    if (!deduction.success) {
      return NextResponse.json(
        { success: false, error: deduction.error || "Failed to process tokens" },
        { status: 402 }
      );
    }

    await db.videoProject.update({ where: { id: projectId }, data: { status: "generating" } });

    const videoSize = VIDEO_SIZE_MAP[project.aspectRatio] || "1920x1080";
    const thumbSize = THUMB_SIZE_MAP[project.aspectRatio] || "1344x768";
    // Capture the public origin while we still have the request — the
    // background task needs it to build absolute reference-image URLs.
    const origin = publicOrigin(req);

    // Character context for character-aware generation prompts (video + thumbnails),
    // plus the project's video engine selection and aspect ratio (used by Vidu models)
    const genCtx = {
      style: project.style || "cinematic",
      characters: (project.characters || []) as CharacterLike[],
      aspectRatio: project.aspectRatio || "16:9",
      videoModel: project.videoModel ?? null,
    };

    // Mark scenes as generating immediately
    for (const scene of scenesToProcess) {
      await db.videoScene.update({ where: { id: scene.id }, data: { status: "generating", errorMessage: null } });
    }

    // Return immediately — all work happens in background
    (async () => {
      try {
        const taskIds: { sceneId: string; sceneNumber: number; taskId: string }[] = [];
        let hitRateLimit = false;

        // Phase 1: Create video tasks sequentially
        for (let i = 0; i < scenesToProcess.length; i++) {
          const scene = scenesToProcess[i];
          try {
            const taskId = await createSceneTask(scene, videoSize, origin, genCtx);
            if (taskId) {
              taskIds.push({ sceneId: scene.id, sceneNumber: scene.sceneNumber, taskId });
            }
          } catch (err) {
            const { message, isRateLimit } = getErrorInfo(err);
            console.error(`Scene ${scene.sceneNumber}: failed to create task`, message);
            await db.videoScene.update({
              where: { id: scene.id },
              data: { status: "failed", errorMessage: message },
            }).catch(() => {});

            if (isRateLimit) {
              hitRateLimit = true;
              // Stop trying more scenes — they'll all hit the same limit.
              // Mark remaining pending scenes as failed with rate limit message.
              for (let j = i + 1; j < scenesToProcess.length; j++) {
                const remaining = scenesToProcess[j];
                await db.videoScene.update({
                  where: { id: remaining.id },
                  data: { status: "failed", errorMessage: message },
                }).catch(() => {});
              }
              break;
            }
          }
          // Wait between scenes to avoid rate limits.
          // After a successful task creation, wait a short delay.
          // The actual video processing happens async, so we just need
          // to avoid hammering the task creation endpoint.
          if (i < scenesToProcess.length - 1 && !hitRateLimit) {
            await sleep(15_000); // 15 seconds between scene task creations
          }
        }

        // Phase 1.5: Generate missing thumbnails IN PARALLEL with polling —
        // the video tasks are already running, so the thumbnails just fill
        // in the scene previews while we wait.
        const thumbnailPromise = generateMissingThumbnails(scenesToProcess, thumbSize, genCtx)
          .catch((e) => console.error("Thumbnail pass crashed (non-fatal):", e));

        // Phase 2: Poll for completion sequentially
        console.log(`Project ${projectId}: ${taskIds.length} tasks created, polling...`);
        for (const entry of taskIds) {
          try {
            await pollTaskUntilDone(entry.taskId, entry.sceneId, entry.sceneNumber);
          } catch (err) {
            const { message } = getErrorInfo(err);
            console.error(`Scene ${entry.sceneNumber}: polling crashed`, message);
            await db.videoScene.update({
              where: { id: entry.sceneId },
              data: { status: "failed", errorMessage: message },
            }).catch(() => {});
          }
          await sleep(3_000);
        }

        // Make sure the parallel thumbnail pass finished before the
        // final status updates below (it's non-fatal either way).
        await thumbnailPromise;

        // Phase 3: Update project status
        const allScenes = await db.videoScene.findMany({ where: { projectId } });
        const allDone = allScenes.every((s) => s.videoUrl);
        if (allDone) {
          await db.videoProject.update({ where: { id: projectId }, data: { status: "completed" } });
          console.log(`Project ${projectId}: all scenes completed!`);
        } else {
          const completed = allScenes.filter((s) => s.videoUrl).length;
          const failed = allScenes.filter((s) => s.status === "failed").length;
          const pending = allScenes.filter((s) => !s.videoUrl && s.status !== "failed").length;
          console.log(`Project ${projectId}: done with ${completed} completed, ${failed} failed, ${pending} pending`);

          // ── Refund tokens for failed scenes ──
          if (failed > 0) {
            const refundAmount = failed * tokensPerScene;
            await refundTokens({
              userId,
              amount: refundAmount,
              description: `Refund: ${failed} failed scene${failed > 1 ? "s" : ""} in "${project.title}"`,
              referenceId: projectId,
              operation: "video_gen",
            }).catch((e) => console.error("Failed to refund tokens:", e));
            console.log(`Project ${projectId}: refunded ${refundAmount} tokens for ${failed} failed scenes`);
          }
        }
      } catch (fatalErr) {
        console.error(`Project ${projectId}: background generation crashed`, fatalErr);
        await db.videoProject.update({ where: { id: projectId }, data: { status: "failed" } }).catch(() => {});
        await db.videoScene.updateMany({
          where: { projectId, status: "generating" },
          data: { status: "failed", errorMessage: "An unexpected error occurred during generation." },
        }).catch(() => {});

        await refundTokens({
          userId,
          amount: totalTokensNeeded,
          description: `Full refund: generation failed for "${project.title}"`,
          referenceId: projectId,
          operation: "video_gen",
        }).catch((e) => console.error("Failed to refund tokens on crash:", e));
      }
    })();

    const skipped = project.scenes.length - scenesToProcess.length;
    return NextResponse.json({
      success: true,
      message: `Generating ${scenesToProcess.length} scene${scenesToProcess.length > 1 ? "s" : ""}${skipped > 0 ? ` (${skipped} already done)` : ""}. Videos will appear as they complete.`,
      sceneCount: scenesToProcess.length,
      totalScenes: project.scenes.length,
      tokensCharged: totalTokensNeeded,
      remainingTokens: deduction.remainingTokens,
    });
  } catch (error) {
    const sess = await getServerSession(authOptions).catch(() => null);
    return zaiErrorResponse(error, {
      session: sess,
      logLabel: "generate-video",
    });
  }
}
