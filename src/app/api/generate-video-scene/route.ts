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

/**
 * Extract video URL from the async result — handles multiple possible response structures.
 */
function extractVideoUrl(result: Record<string, unknown>): string | null {
  // Check nested video_result array
  if (result.video_result && Array.isArray(result.video_result) && result.video_result.length > 0) {
    const first = result.video_result[0] as Record<string, unknown>;
    if (first.url && typeof first.url === "string") return first.url;
    if (first.video_url && typeof first.video_url === "string") return first.video_url;
  }
  // Check top-level fields
  if (result.video_url && typeof result.video_url === "string") return result.video_url;
  if (result.url && typeof result.url === "string") return result.url;
  if (result.video && typeof result.video === "string") return result.video;
  if (result.output && typeof result.output === "string") return result.output;
  if (result.result && typeof result.result === "string") return result.result;
  // Check nested result object
  if (result.result && typeof result.result === "object" && result.result !== null) {
    const nested = result.result as Record<string, unknown>;
    if (nested.url && typeof nested.url === "string") return nested.url;
    if (nested.video_url && typeof nested.video_url === "string") return nested.video_url;
    if (nested.video && typeof nested.video === "string") return nested.video;
  }
  // Check data field
  if (result.data && typeof result.data === "object" && result.data !== null) {
    const data = result.data as Record<string, unknown>;
    if (data.url && typeof data.url === "string") return data.url;
    if (data.video_url && typeof data.video_url === "string") return data.video_url;
  }
  return null;
}

/**
 * Check if the task status indicates completion — handles multiple API conventions.
 */
function isTaskComplete(status: string): boolean {
  const s = status.toUpperCase().trim();
  return s === "SUCCESS" || s === "COMPLETED" || s === "SUCCEEDED" || s === "DONE" || s === "FINISHED" || s === "COMPLETE";
}

function isTaskFailed(status: string): boolean {
  const s = status.toUpperCase().trim();
  return s === "FAIL" || s === "FAILED" || s === "ERROR" || s === "CANCELLED" || s === "CANCELED" || s === "REJECTED";
}

export async function POST(req: NextRequest) {
  try {
    const { prompt, sceneId, projectId, duration } = await req.json();

    if (!prompt || !sceneId) {
      return NextResponse.json(
        { success: false, error: "Prompt and sceneId are required" },
        { status: 400 }
      );
    }

    // Get the project for aspect ratio and scene context
    let aspectRatio = "16:9";
    let referenceImage: string | undefined;

    if (projectId) {
      const project = await db.videoProject.findUnique({
        where: { id: projectId },
        include: {
          scenes: { where: { id: sceneId }, take: 1 },
          characters: { orderBy: { createdAt: "asc" } },
        },
      });
      if (project) {
        aspectRatio = project.aspectRatio;

        // Get reference image from the scene or first character
        const scene = project.scenes[0];
        if (scene?.referenceImageUrl) {
          referenceImage = scene.referenceImageUrl;
        } else if (scene?.characterIds) {
          try {
            const charIds: string[] = JSON.parse(scene.characterIds);
            if (charIds.length > 0) {
              const firstChar = project.characters.find((c) => c.id === charIds[0]);
              if (firstChar?.imageUrl) referenceImage = firstChar.imageUrl;
            }
          } catch { /* ignore parse errors */ }
        }
      }
    }

    const videoSize = VIDEO_SIZE_MAP[aspectRatio] || "1920x1080";
    const thumbSize = THUMB_SIZE_MAP[aspectRatio] || "1344x768";

    const zai = await ZAI.create();

    // Step 1: Generate thumbnail image if scene doesn't have one
    let imageUrl: string | null = null;
    const sceneData = await db.videoScene.findUnique({ where: { id: sceneId }, select: { imageUrl: true } });
    if (!sceneData?.imageUrl) {
      try {
        const imgResponse = await withRetry(
          () => zai.images.generations.create({
            prompt,
            size: thumbSize as "1024x1024" | "768x1344" | "864x1152" | "1344x768" | "1152x864" | "1440x720" | "720x1440",
          }),
          "Thumbnail generation"
        );
        const imageBase64 = imgResponse.data[0].base64;
        const buffer = Buffer.from(imageBase64, "base64");
        const outputDir = path.join(process.cwd(), "public", "generated");
        await mkdir(outputDir, { recursive: true });
        const filename = `thumb_${Date.now()}_${sceneId.slice(0, 8)}.png`;
        const filepath = path.join(outputDir, filename);
        await writeFile(filepath, buffer);
        imageUrl = `/generated/${filename}`;
        await db.videoScene.update({ where: { id: sceneId }, data: { imageUrl } });
      } catch (imgErr) {
        console.error("Thumbnail generation failed (non-fatal):", imgErr);
      }
    } else {
      imageUrl = sceneData.imageUrl;
    }

    // Step 2: Create video generation task
    const videoParams: Record<string, unknown> = {
      prompt,
      quality: "quality",
      size: videoSize,
      duration: duration || 10,
      with_audio: false,
      watermark_enabled: false,
    };
    if (referenceImage) {
      videoParams.image_url = referenceImage;
      console.log(`Using reference image: ${referenceImage}`);
    }

    const task = await withRetry(
      () => zai.video.generations.create(videoParams),
      "Video generation task"
    );

    const taskId = task.id;
    console.log(`Video generation task created: ${taskId}`);

    // Update scene status
    await db.videoScene.update({
      where: { id: sceneId },
      data: { taskId, status: "generating" },
    });

    // Step 3: Poll for video result
    const MAX_ATTEMPTS = 80;
    const POLL_INTERVAL = 15000;

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await sleep(POLL_INTERVAL);

      try {
        const result = await zai.async.result.query(taskId);
        const resultObj = result as unknown as Record<string, unknown>;
        const status = String(resultObj.task_status || resultObj.status || "UNKNOWN");

        if (i === 0 || i % 5 === 0) {
          console.log(`Task ${taskId}: poll ${i + 1}/${MAX_ATTEMPTS} -> ${status}`);
        }

        // Check for completion with multiple status conventions
        if (isTaskComplete(status)) {
          const videoUrl = extractVideoUrl(resultObj);
          if (videoUrl) {
            await db.videoScene.update({
              where: { id: sceneId },
              data: { videoUrl, status: "completed" },
            });
            console.log(`Video ready: ${videoUrl.slice(0, 80)}...`);
            return NextResponse.json({
              success: true,
              videoUrl,
              taskId,
              imageUrl,
            });
          }

          // SUCCESS but no URL found — try regex fallback
          console.error(`Task succeeded but no URL found. Response:`, JSON.stringify(resultObj).slice(0, 500));
          const allValues = JSON.stringify(resultObj);
          const urlMatch = allValues.match(/https?:\/\/[^\s"']+/);
          if (urlMatch) {
            const extractedUrl = urlMatch[0];
            await db.videoScene.update({
              where: { id: sceneId },
              data: { videoUrl: extractedUrl, status: "completed" },
            });
            console.log(`Extracted URL from response: ${extractedUrl.slice(0, 80)}...`);
            return NextResponse.json({
              success: true,
              videoUrl: extractedUrl,
              taskId,
              imageUrl,
            });
          }

          await db.videoScene.update({
            where: { id: sceneId },
            data: { status: "failed" },
          });
          return NextResponse.json({
            success: false,
            error: "Video generation completed but no video URL was returned by the service",
          });
        }

        // Check for failure
        if (isTaskFailed(status)) {
          console.error(`Video generation task ${status}: ${taskId}`);
          await db.videoScene.update({
            where: { id: sceneId },
            data: { status: "failed" },
          });
          return NextResponse.json({
            success: false,
            error: `Video generation failed on the server (${status})`,
          });
        }

        // Early exit: check if video URL is available even while still processing
        const earlyUrl = extractVideoUrl(resultObj);
        if (earlyUrl) {
          console.log(`Found video URL while status=${status}, using it`);
          await db.videoScene.update({
            where: { id: sceneId },
            data: { videoUrl: earlyUrl, status: "completed" },
          });
          return NextResponse.json({
            success: true,
            videoUrl: earlyUrl,
            taskId,
            imageUrl,
          });
        }

        // Still PROCESSING - continue polling
      } catch (pollErr) {
        const msg = pollErr instanceof Error ? pollErr.message : String(pollErr);
        if (msg.includes("429") || msg.includes("rate limit")) {
          console.log(`Rate limited during poll, backing off 30s`);
          await sleep(30000);
        } else {
          console.error(`Poll error for task ${taskId}:`, msg);
          await sleep(10000);
        }
      }
    }

    // Timeout — keep as generating so frontend can still poll via video-status
    console.error(`Video generation timed out for task: ${taskId}`);
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
