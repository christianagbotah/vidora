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

export async function POST(req: NextRequest) {
  try {
    const { projectId } = await req.json();

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: "Project ID is required" },
        { status: 400 }
      );
    }

    const project = await db.videoProject.findUnique({
      where: { id: projectId },
      include: { scenes: { orderBy: { sceneNumber: "asc" } } },
    });

    if (!project) {
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 }
      );
    }

    await db.videoProject.update({
      where: { id: projectId },
      data: { status: "generating" },
    });

    const zai = await ZAI.create();
    const outputDir = path.join(process.cwd(), "public", "generated");
    await mkdir(outputDir, { recursive: true });

    const videoSize = VIDEO_SIZE_MAP[project.aspectRatio] || "1920x1080";
    const thumbSize = THUMB_SIZE_MAP[project.aspectRatio] || "1344x768";
    const updatedScenes = [];

    for (const scene of project.scenes) {
      try {
        await db.videoScene.update({
          where: { id: scene.id },
          data: { status: "generating" },
        });

        const scenePrompt = scene.enhancedPrompt || scene.prompt;

        // Generate thumbnail image
        try {
          const imgResponse = await zai.images.generations.create({
            prompt: scenePrompt,
            size: thumbSize as "1024x1024" | "768x1344" | "864x1152" | "1344x768" | "1152x864" | "1440x720" | "720x1440",
          });
          const imageBase64 = imgResponse.data[0].base64;
          const buffer = Buffer.from(imageBase64, "base64");
          const filename = `thumb_${Date.now()}_${scene.sceneNumber}.png`;
          const filepath = path.join(outputDir, filename);
          await writeFile(filepath, buffer);
          const imageUrl = `/generated/${filename}`;
          await db.videoScene.update({
            where: { id: scene.id },
            data: { imageUrl },
          });
        } catch (imgErr) {
          console.error(`Thumbnail failed for scene ${scene.sceneNumber}:`, imgErr);
        }

        // Create video generation task
        const task = await zai.video.generations.create({
          prompt: scenePrompt,
          quality: "quality",
          size: videoSize,
          with_audio: false,
          watermark_enabled: false,
        });

        await db.videoScene.update({
          where: { id: scene.id },
          data: { taskId: task.id },
        });

        console.log(`Scene ${scene.sceneNumber}: video task ${task.id} created, polling...`);

        // Poll for result
        const MAX_ATTEMPTS = 20;
        let videoReady = false;

        for (let i = 0; i < MAX_ATTEMPTS; i++) {
          await sleep(8000);
          try {
            const result = await zai.async.result.query(task.id);
            if (result.task_status === "SUCCESS") {
              const videoUrl = extractVideoUrl(result as unknown as Record<string, unknown>);
              if (videoUrl) {
                await db.videoScene.update({
                  where: { id: scene.id },
                  data: { videoUrl, status: "completed" },
                });
                console.log(`Scene ${scene.sceneNumber}: video ready!`);
                videoReady = true;
                break;
              }
            }
            if (result.task_status === "FAIL") {
              console.error(`Scene ${scene.sceneNumber}: video task failed`);
              await db.videoScene.update({
                where: { id: scene.id },
                data: { status: "failed" },
              });
              break;
            }
          } catch (pollErr) {
            console.error(`Poll error scene ${scene.sceneNumber}:`, pollErr);
          }
        }

        if (!videoReady) {
          // Still generating - leave status as 'generating'
          console.log(`Scene ${scene.sceneNumber}: still processing after polling, will continue in background`);
        }

        const updated = await db.videoScene.findUnique({ where: { id: scene.id } });
        if (updated) updatedScenes.push(updated);
      } catch (err) {
        console.error(`Failed to generate scene ${scene.sceneNumber}:`, err);
        await db.videoScene.update({
          where: { id: scene.id },
          data: { status: "failed" },
        });
        updatedScenes.push({ ...scene, status: "failed" });
      }
    }

    const allCompleted = updatedScenes.every((s) => s.status === "completed");
    const anyCompleted = updatedScenes.some((s) => s.status === "completed");
    await db.videoProject.update({
      where: { id: projectId },
      data: { status: allCompleted ? "completed" : anyCompleted ? "generating" : "failed" },
    });

    const firstScene = project.scenes[0];
    if (firstScene) {
      await db.generationHistory.create({
        data: { prompt: firstScene.prompt, inputType: "text", style: project.style },
      });
    }

    const completedCount = updatedScenes.filter((s) => s.status === "completed").length;
    return NextResponse.json({
      success: true,
      message: `Generated ${completedCount} of ${updatedScenes.length} video scenes` + (completedCount < updatedScenes.length ? ". Remaining scenes are still processing." : ""),
      scenes: updatedScenes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to generate video:", error);
    try {
      const body = await req.clone().json().catch(() => null);
      if (body?.projectId) {
        await db.videoProject.update({ where: { id: body.projectId }, data: { status: "draft" } });
      }
    } catch {}
    return NextResponse.json(
      { success: false, error: "Failed to generate video: " + message },
      { status: 500 }
    );
  }
}
