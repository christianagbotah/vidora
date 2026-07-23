import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
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
    const { prompt, sceneId, projectId } = await req.json();

    if (!prompt || !sceneId) {
      return NextResponse.json(
        { success: false, error: "Prompt and sceneId are required" },
        { status: 400 }
      );
    }

    // Get the project for aspect ratio
    let aspectRatio = "16:9";
    if (projectId) {
      const project = await db.videoProject.findUnique({ where: { id: projectId } });
      if (project) aspectRatio = project.aspectRatio;
    }

    const videoSize = VIDEO_SIZE_MAP[aspectRatio] || "1920x1080";
    const thumbSize = THUMB_SIZE_MAP[aspectRatio] || "1344x768";

    const zai = await ZAI.create();

    // Step 1: Create video generation task
    const task = await zai.video.generations.create({
      prompt,
      quality: "quality",
      size: videoSize,
      with_audio: false,
      watermark_enabled: false,
    });

    const taskId = task.id;
    console.log(`Video generation task created: ${taskId}`);

    // Save taskId to scene
    await db.videoScene.update({
      where: { id: sceneId },
      data: { taskId, status: "generating" },
    });

    // Step 2: Generate thumbnail image in parallel
    let imageUrl: string | null = null;
    try {
      const imgResponse = await zai.images.generations.create({
        prompt,
        size: thumbSize as "1024x1024" | "768x1344" | "864x1152" | "1344x768" | "1152x864" | "1440x720" | "720x1440",
      });
      const imageBase64 = imgResponse.data[0].base64;
      const buffer = Buffer.from(imageBase64, "base64");
      const outputDir = path.join(process.cwd(), "public", "generated");
      await mkdir(outputDir, { recursive: true });
      const filename = `thumb_${Date.now()}_${sceneId.slice(0, 8)}.png`;
      const filepath = path.join(outputDir, filename);
      await writeFile(filepath, buffer);
      imageUrl = `/generated/${filename}`;
      await db.videoScene.update({
        where: { id: sceneId },
        data: { imageUrl },
      });
    } catch (imgErr) {
      console.error("Thumbnail generation failed (non-fatal):", imgErr);
    }

    // Step 3: Poll for video result
    const MAX_ATTEMPTS = 15;
    const POLL_INTERVAL = 8000;

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await sleep(POLL_INTERVAL);

      try {
        const result = await zai.async.result.query(taskId);
        const status = result.task_status;

        if (status === "SUCCESS") {
          const videoUrl = extractVideoUrl(result as unknown as Record<string, unknown>);
          if (videoUrl) {
            await db.videoScene.update({
              where: { id: sceneId },
              data: { videoUrl, status: "completed" },
            });
            console.log(`Video ready: ${videoUrl}`);
            return NextResponse.json({
              success: true,
              videoUrl,
              taskId,
              imageUrl,
            });
          }
          // Task succeeded but no URL found
          console.error("Video task succeeded but no URL found:", JSON.stringify(result).slice(0, 300));
          await db.videoScene.update({
            where: { id: sceneId },
            data: { status: "failed" },
          });
          return NextResponse.json({
            success: false,
            error: "Video generation completed but no video URL was returned",
          });
        }

        if (status === "FAIL") {
          console.error(`Video generation task failed: ${taskId}`);
          await db.videoScene.update({
            where: { id: sceneId },
            data: { status: "failed" },
          });
          return NextResponse.json({
            success: false,
            error: "Video generation failed on the server",
          });
        }

        // Still PROCESSING - continue polling
        console.log(`Video task ${taskId} still processing (attempt ${i + 1}/${MAX_ATTEMPTS})`);
      } catch (pollErr) {
        console.error(`Poll error for task ${taskId}:`, pollErr);
      }
    }

    // Timeout
    console.error(`Video generation timed out for task: ${taskId}`);
    await db.videoScene.update({
      where: { id: sceneId },
      data: { status: "generating" }, // Keep as generating - frontend can still poll
    });
    return NextResponse.json({
      success: true,
      taskId,
      imageUrl,
      status: "processing",
      message: "Video is still being generated. It will be available shortly.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to generate video scene:", error);
    return NextResponse.json(
      { success: false, error: "Failed to generate video: " + message },
      { status: 500 }
    );
  }
}
