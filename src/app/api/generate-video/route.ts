import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import ZAI from "z-ai-web-dev-sdk";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

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

function isRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("429") || msg.includes("rate limit") || msg.includes("Too many requests");
}

async function withRetry<T>(fn: () => Promise<T>, label: string, maxRetries = 5): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isRetryableError(err) && attempt < maxRetries) {
        const delay = Math.min(30000, 5000 * Math.pow(2, attempt - 1));
        console.log(`${label}: rate limited, retry ${attempt}/${maxRetries} in ${delay}ms`);
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
  throw new Error(label + ": max retries exceeded");
}

function extractVideoUrl(result: Record<string, unknown>): string | null {
  if (result.video_result && Array.isArray(result.video_result) && result.video_result.length > 0) {
    const first = result.video_result[0] as Record<string, unknown>;
    if (first.url && typeof first.url === "string") return first.url;
  }
  if (result.video_url && typeof result.video_url === "string") return result.video_url;
  if (result.url && typeof result.url === "string") return result.url;
  if (result.video && typeof result.video === "string") return result.video;
  return null;
}

async function createSceneTask(
  scene: { id: string; sceneNumber: number; prompt: string; enhancedPrompt: string | null; imageUrl?: string | null; referenceImageUrl?: string | null; characterIds?: string | null },
  videoSize: string,
  thumbSize: string,
  zai: Awaited<ReturnType<typeof ZAI.create>>
): Promise<string | null> {
  const scenePrompt = scene.enhancedPrompt || scene.prompt;
  const outputDir = path.join(process.cwd(), "public", "generated");
  await mkdir(outputDir, { recursive: true });

  // Generate thumbnail only if scene doesn't have one
  if (!scene.imageUrl) {
    try {
      const imgResponse = await withRetry(
        () => zai.images.generations.create({
          prompt: scenePrompt,
          size: thumbSize as "1024x1024" | "768x1344" | "864x1152" | "1344x768" | "1152x864" | "1440x720" | "720x1440",
        }),
        `Scene ${scene.sceneNumber} thumbnail`
      );
      const imageBase64 = imgResponse.data[0].base64;
      const buffer = Buffer.from(imageBase64, "base64");
      const filename = `thumb_${Date.now()}_${scene.sceneNumber}.png`;
      await writeFile(path.join(outputDir, filename), buffer);
      await db.videoScene.update({ where: { id: scene.id }, data: { imageUrl: `/generated/${filename}` } });
      console.log(`Scene ${scene.sceneNumber}: thumbnail saved`);
    } catch (imgErr) {
      console.error(`Scene ${scene.sceneNumber}: thumbnail failed (non-fatal)`, imgErr);
    }
  }

  // Determine reference image URL (scene-specific or character-based)
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

  // Create video generation task (with optional image reference for character animation)
  const videoParams: Record<string, unknown> = {
    prompt: scenePrompt,
    quality: "quality",
    size: videoSize,
    duration: 10,
    with_audio: false,
    watermark_enabled: false,
  };
  if (referenceImage) {
    videoParams.image_url = referenceImage;
    console.log(`Scene ${scene.sceneNumber}: using reference image ${referenceImage}`);
  }

  const task = await withRetry(
    () => zai.video.generations.create(videoParams),
    `Scene ${scene.sceneNumber} video task${referenceImage ? ' (with image ref)' : ''}`
  );

  await db.videoScene.update({ where: { id: scene.id }, data: { taskId: task.id, status: "generating" } });
  console.log(`Scene ${scene.sceneNumber}: video task ${task.id} created`);
  return task.id;
}

async function pollTaskUntilDone(
  taskId: string,
  sceneId: string,
  sceneNumber: number,
  zai: Awaited<ReturnType<typeof ZAI.create>>
): Promise<string | null> {
  const MAX_ATTEMPTS = 40; // 40 * 15s = 600s = 10 minutes
  const POLL_INTERVAL = 15000;

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL);

    try {
      const result = await zai.async.result.query(taskId);
      const status = result.task_status;

      console.log(`Scene ${sceneNumber} (${taskId}): poll ${i + 1}/${MAX_ATTEMPTS} -> ${status}`);

      if (status === "SUCCESS") {
        const videoUrl = extractVideoUrl(result as unknown as Record<string, unknown>);
        if (videoUrl) {
          await db.videoScene.update({ where: { id: sceneId }, data: { videoUrl, status: "completed" } });
          console.log(`Scene ${sceneNumber}: video ready!`);
          return videoUrl;
        }
        console.error(`Scene ${sceneNumber}: SUCCESS but no URL. Keys: ${Object.keys(result).join(",")}`);
        await db.videoScene.update({ where: { id: sceneId }, data: { status: "failed" } });
        return null;
      }

      if (status === "FAIL") {
        console.error(`Scene ${sceneNumber}: task failed on server`);
        await db.videoScene.update({ where: { id: sceneId }, data: { status: "failed" } });
        return null;
      }
    } catch (pollErr) {
      const msg = pollErr instanceof Error ? pollErr.message : String(pollErr);
      if (msg.includes("429") || msg.includes("rate limit")) {
        console.log(`Scene ${sceneNumber}: rate limited during poll, backing off 30s`);
        await sleep(30000);
      } else {
        console.error(`Scene ${sceneNumber}: poll error: ${msg}`);
        await sleep(10000);
      }
    }
  }

  console.error(`Scene ${sceneNumber}: polling timed out after ${MAX_ATTEMPTS} attempts`);
  return null;
}

export async function POST(req: NextRequest) {
  try {
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
    if (project.scenes.length === 0) {
      return NextResponse.json({ success: false, error: "No scenes in project" }, { status: 400 });
    }

    // Only process pending scenes (skip failed and completed)
    const scenesToProcess = project.scenes.filter(
      (s) => !s.videoUrl && s.status === "pending"
    );

    if (scenesToProcess.length === 0) {
      const hasGenerating = project.scenes.some((s) => s.status === "generating");
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

    await db.videoProject.update({ where: { id: projectId }, data: { status: "generating" } });

    const videoSize = VIDEO_SIZE_MAP[project.aspectRatio] || "1920x1080";
    const thumbSize = THUMB_SIZE_MAP[project.aspectRatio] || "1344x768";

    // Mark scenes as generating immediately
    for (const scene of scenesToProcess) {
      await db.videoScene.update({ where: { id: scene.id }, data: { status: "generating" } });
    }

    // Return immediately — all work in background
    (async () => {
      const zai = await ZAI.create();
      const taskIds: { sceneId: string; sceneNumber: number; taskId: string }[] = [];

      // Phase 1: Create video tasks (sequential to avoid rate limits)
      for (let i = 0; i < scenesToProcess.length; i++) {
        const scene = scenesToProcess[i];
        try {
          const taskId = await createSceneTask(scene, videoSize, thumbSize, zai);
          if (taskId) {
            taskIds.push({ sceneId: scene.id, sceneNumber: scene.sceneNumber, taskId });
          }
        } catch (err) {
          console.error(`Scene ${scene.sceneNumber}: failed to create task`, err);
          await db.videoScene.update({ where: { id: scene.id }, data: { status: "failed" } });
        }
        if (i < scenesToProcess.length - 1) await sleep(8000);
      }

      // Phase 2: Poll for completion (sequential, one at a time)
      console.log(`Project ${projectId}: ${taskIds.length} tasks created, polling...`);
      for (const entry of taskIds) {
        try {
          await pollTaskUntilDone(entry.taskId, entry.sceneId, entry.sceneNumber, zai);
        } catch (err) {
          console.error(`Scene ${entry.sceneNumber}: polling crashed`, err);
          await db.videoScene.update({ where: { id: entry.sceneId }, data: { status: "failed" } });
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
        console.log(`Project ${projectId}: done with ${completed} completed, ${failed} failed`);
      }
    })();

    const skipped = project.scenes.length - scenesToProcess.length;
    return NextResponse.json({
      success: true,
      message: `Generating ${scenesToProcess.length} scene${scenesToProcess.length > 1 ? "s" : ""}${skipped > 0 ? " (" + skipped + " already done)" : ""}. Videos will appear as they complete.`,
      sceneCount: scenesToProcess.length,
      totalScenes: project.scenes.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to start generation:", error);
    return NextResponse.json({ success: false, error: "Failed to start generation: " + message }, { status: 500 });
  }
}
