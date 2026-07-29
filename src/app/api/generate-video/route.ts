import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { zai } from "@/lib/zai";
import { zaiErrorResponse } from "@/lib/zai-errors";
import { checkTokens, deductTokensForOperation, refundTokens } from "@/lib/tokens";
import { PRICING, calculateProjectCost } from "@/lib/pricing";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 300;

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

async function createSceneTask(
  scene: {
    id: string; sceneNumber: number; prompt: string; enhancedPrompt: string | null;
    imageUrl?: string | null; referenceImageUrl?: string | null; characterIds?: string | null;
  },
  videoSize: string,
  thumbSize: string
): Promise<string | null> {
  const scenePrompt = scene.enhancedPrompt || scene.prompt;
  const outputDir = path.join(process.cwd(), "public", "generated");
  await mkdir(outputDir, { recursive: true });

  // Generate thumbnail only if scene doesn't have one
  if (!scene.imageUrl) {
    try {
      const imageBase64 = await zai.generateImage({
        prompt: scenePrompt,
        size: thumbSize as "1024x1024" | "768x1344" | "864x1152" | "1344x768" | "1152x864" | "1440x720" | "720x1440",
        retry: { label: `Scene ${scene.sceneNumber} thumbnail`, timeoutMs: 120_000, maxRetries: 4 },
      });
      const buffer = Buffer.from(imageBase64, "base64");
      const filename = `thumb_${Date.now()}_${scene.sceneNumber}.png`;
      await writeFile(path.join(outputDir, filename), buffer);
      await db.videoScene.update({ where: { id: scene.id }, data: { imageUrl: `/generated/${filename}` } });
      console.log(`Scene ${scene.sceneNumber}: thumbnail saved`);
    } catch (imgErr) {
      console.error(`Scene ${scene.sceneNumber}: thumbnail failed (non-fatal)`, imgErr);
    }
  }

  // Determine reference image URL
  let referenceImage: string | undefined;
  if (scene.referenceImageUrl) {
    referenceImage = scene.referenceImageUrl;
  } else if (scene.characterIds) {
    try {
      const charIds: string[] = JSON.parse(scene.characterIds);
      if (charIds.length > 0) {
        const firstChar = await db.character.findUnique({ where: { id: charIds[0] } });
        if (firstChar?.imageUrl) referenceImage = firstChar.imageUrl;
      }
    } catch { /* ignore parse errors */ }
  }

  // Create video generation task via centralized wrapper
  const taskId = await zai.generateVideo({
    prompt: scenePrompt,
    size: videoSize,
    duration: 10,
    quality: "quality",
    withAudio: false,
    ...(referenceImage ? { imageUrl: referenceImage } : {}),
    retry: { label: `Scene ${scene.sceneNumber} video task`, timeoutMs: 120_000, maxRetries: 4 },
  });

  await db.videoScene.update({ where: { id: scene.id }, data: { taskId, status: "generating" } });
  console.log(`Scene ${scene.sceneNumber}: video task ${taskId} created`);
  return taskId;
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
    await db.videoScene.update({ where: { id: sceneId }, data: { videoUrl: result.videoUrl, status: "completed" } });
    console.log(`Scene ${sceneNumber}: video ready! URL: ${result.videoUrl.slice(0, 80)}...`);
    return result.videoUrl;
  }

  if (result.status === "timeout") {
    // Timeout — leave in "generating" state so the frontend can keep polling
    console.warn(`Scene ${sceneNumber}: polling timed out, scene left in "generating" state for client polling`);
    return null;
  }

  // Failed
  console.error(`Scene ${sceneNumber}: task failed. ${result.error ?? ""}`);
  await db.videoScene.update({ where: { id: sceneId }, data: { status: "failed" } });
  return null;
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
      include: { scenes: { orderBy: { sceneNumber: "asc" } } },
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

    // Process pending scenes only (also retry scenes stuck in "generating" with no taskId)
    const scenesToProcess = project.scenes.filter(
      (s) => !s.videoUrl && (s.status === "pending" || (s.status === "generating" && !s.taskId))
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
    // Calculate the token cost for this generation batch.
    // Each scene = 1 video clip + 1 thumbnail image.
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
        { status: 402 } // 402 Payment Required
      );
    }

    // ── Deduct Tokens ──
    // Deduct all tokens upfront. If generation fails, we refund per failed scene.
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

    // Mark scenes as generating immediately
    for (const scene of scenesToProcess) {
      await db.videoScene.update({ where: { id: scene.id }, data: { status: "generating" } });
    }

    // Return immediately — all work happens in background
    // CRITICAL: wrap the entire IIFE in try/catch to prevent unhandled promise rejections
    (async () => {
      try {
        const taskIds: { sceneId: string; sceneNumber: number; taskId: string }[] = [];

        // Phase 1: Create video tasks sequentially to avoid rate limits
        for (let i = 0; i < scenesToProcess.length; i++) {
          const scene = scenesToProcess[i];
          try {
            const taskId = await createSceneTask(scene, videoSize, thumbSize);
            if (taskId) {
              taskIds.push({ sceneId: scene.id, sceneNumber: scene.sceneNumber, taskId });
            }
          } catch (err) {
            console.error(`Scene ${scene.sceneNumber}: failed to create task`, err);
            await db.videoScene.update({ where: { id: scene.id }, data: { status: "failed" } }).catch(() => {});
          }
          if (i < scenesToProcess.length - 1) await sleep(8000);
        }

        // Phase 2: Poll for completion sequentially
        console.log(`Project ${projectId}: ${taskIds.length} tasks created, polling...`);
        for (const entry of taskIds) {
          try {
            await pollTaskUntilDone(entry.taskId, entry.sceneId, entry.sceneNumber);
          } catch (err) {
            console.error(`Scene ${entry.sceneNumber}: polling crashed`, err);
            await db.videoScene.update({ where: { id: entry.sceneId }, data: { status: "failed" } }).catch(() => {});
          }
          await sleep(3000);
        }

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
          // We charged upfront for all scenes; refund the ones that failed
          // so the user doesn't pay for failed generations.
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
        // Top-level catch ensures no unhandled promise rejection crashes the process
        console.error(`Project ${projectId}: background generation crashed`, fatalErr);
        await db.videoProject.update({ where: { id: projectId }, data: { status: "failed" } }).catch(() => {});
        await db.videoScene.updateMany({
          where: { projectId, status: "generating" },
          data: { status: "failed" },
        }).catch(() => {});

        // ── Full refund on fatal crash ──
        // Since we deducted tokens upfront, refund the full amount
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
    // session is in scope from the try block via closure — but since this is the
    // outer catch, fetch it again to be safe (cheap, cached).
    const sess = await getServerSession(authOptions).catch(() => null);
    return zaiErrorResponse(error, {
      session: sess,
      logLabel: "generate-video",
    });
  }
}
