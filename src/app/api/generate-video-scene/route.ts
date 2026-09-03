import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { zai, ZAIError } from "@/lib/zai";
import { requireProjectAccess } from "@/lib/project-auth";
import {
  saveGeneratedFile,
  publicOrigin,
  toAbsoluteUrl,
} from "@/lib/generated-store";

export const runtime = "nodejs";

/**
 * POST /api/generate-video-scene
 *
 * Generates the video for a single scene (Studio "Generate" button).
 *
 * IMPORTANT — returns immediately (< ~1s). All heavy work (thumbnail,
 * task creation, polling) runs in a background task, exactly like the
 * batch /api/generate-video route. The old synchronous design held the
 * HTTP request open for up to 20 minutes while polling the ZAI task,
 * which Cloudflare cuts off at ~100s with a 524 error.
 *
 * The client polls /api/video-status (DB-only, fast) — the scene flips
 * to "completed" (videoUrl set) or "failed" (errorMessage set) when the
 * background task finishes.
 */

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
    const { prompt, sceneId, projectId, duration } = await req.json();

    if (!prompt || !sceneId) {
      return NextResponse.json(
        { success: false, error: "Prompt and sceneId are required" },
        { status: 400 }
      );
    }

    // ── Ownership check ──
    if (projectId) {
      const authResult = await requireProjectAccess(projectId, true);
      if (!authResult.ok) return authResult.response;
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

        const scene = project.scenes[0];
        if (scene?.referenceImageUrl) {
          // Skip base64 data URLs — too large for the API
          if (!scene.referenceImageUrl.startsWith("data:")) {
            referenceImage = scene.referenceImageUrl;
          }
        } else if (scene?.characterIds) {
          try {
            const charIds: string[] = JSON.parse(scene.characterIds);
            if (charIds.length > 0) {
              const firstChar = project.characters.find((c) => c.id === charIds[0]);
              if (firstChar?.imageUrl && !firstChar.imageUrl.startsWith("data:")) {
                referenceImage = firstChar.imageUrl;
              }
            }
          } catch { /* ignore parse errors */ }
        }
      }
    }

    const videoSize = VIDEO_SIZE_MAP[aspectRatio] || "1920x1080";
    const thumbSize = THUMB_SIZE_MAP[aspectRatio] || "1344x768";

    // Resolve the reference image to an absolute URL the ZAI API can
    // fetch (local /generated/... paths are unreachable from the API).
    const origin = publicOrigin(req);
    const absoluteReferenceImage = toAbsoluteUrl(referenceImage, origin);

    // Mark generating right away so the client's status polling sees it
    await db.videoScene.update({
      where: { id: sceneId },
      data: { status: "generating", errorMessage: null },
    }).catch(() => { /* scene may not exist yet client-side */ });

    // ── Fire-and-forget: everything below runs in the background ──
    void runSceneGeneration({
      prompt,
      sceneId,
      duration: duration || 10,
      videoSize,
      thumbSize,
      referenceImage: absoluteReferenceImage,
    }).catch((err) => {
      console.error("[generate-video-scene] background task crashed:", err);
      db.videoScene.update({
        where: { id: sceneId },
        data: {
          status: "failed",
          errorMessage: "An unexpected error occurred during generation.",
        },
      }).catch(() => {});
    });

    // Respond immediately — the client polls /api/video-status
    return NextResponse.json({
      success: true,
      status: "generating",
      message: "Video generation started. This may take a few minutes.",
    });
  } catch (error) {
    console.error("generate-video-scene:", error);
    return NextResponse.json(
      { success: false, error: "Failed to start generation" },
      { status: 500 }
    );
  }
}

/** Background worker: thumbnail → video task → poll → DB updates. */
async function runSceneGeneration(opts: {
  prompt: string;
  sceneId: string;
  duration: number;
  videoSize: string;
  thumbSize: string;
  referenceImage?: string;
}): Promise<void> {
  const { prompt, sceneId, duration, videoSize, thumbSize, referenceImage } = opts;

  // Step 1: Generate thumbnail image if scene doesn't have one
  let imageUrl: string | null = null;
  const sceneData = await db.videoScene.findUnique({
    where: { id: sceneId },
    select: { imageUrl: true },
  });
  if (!sceneData?.imageUrl) {
    try {
      const imageBase64 = await zai.generateImage({
        prompt,
        size: thumbSize as "1024x1024" | "768x1344" | "864x1152" | "1344x768" | "1152x864" | "1440x720" | "720x1440",
        retry: { label: "Thumbnail generation", timeoutMs: 120_000, maxRetries: 4 },
      });
      const buffer = Buffer.from(imageBase64, "base64");
      const filename = `thumb_${Date.now()}_${sceneId.slice(0, 8)}.png`;
      imageUrl = await saveGeneratedFile(filename, buffer);
      await db.videoScene.update({ where: { id: sceneId }, data: { imageUrl } });
    } catch (imgErr) {
      console.error("Thumbnail generation failed (non-fatal):", imgErr);
    }
  } else {
    imageUrl = sceneData.imageUrl;
  }

  // Step 2: Create video generation task
  let taskId: string;
  try {
    taskId = await zai.generateVideo({
      prompt,
      size: videoSize,
      duration,
      quality: "quality",
      withAudio: false,
      ...(referenceImage ? { imageUrl: referenceImage } : {}),
      retry: { label: "Video generation task", timeoutMs: 120_000, maxRetries: 2 },
    });
  } catch (err) {
    const isRateLimit = err instanceof ZAIError && err.kind === "rate_limit";
    const errorMsg = isRateLimit
      ? "Video generation is currently rate-limited. Please wait a few minutes and try again."
      : err instanceof Error ? err.message : String(err);

    await db.videoScene.update({
      where: { id: sceneId },
      data: { status: "failed", errorMessage: errorMsg },
    });
    console.error(`[generate-video-scene] task creation failed: ${errorMsg}`);
    return;
  }

  console.log(`[generate-video-scene] task created: ${taskId}`);

  await db.videoScene.update({
    where: { id: sceneId },
    data: { taskId, status: "generating", errorMessage: null },
  });

  // Step 3: Poll for video result (background — no HTTP timeout applies)
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
    console.log(`[generate-video-scene] video ready: ${result.videoUrl.slice(0, 80)}...`);
    return;
  }

  if (result.status === "timeout") {
    // Leave in "generating" state — client polling + reload recovery
    // handle it; a future /api/video-status call could re-poll.
    console.warn(`[generate-video-scene] polling timed out for task: ${taskId}`);
    return;
  }

  // Failed
  const errorMsg = result.error || "Video generation failed on the server";
  await db.videoScene.update({
    where: { id: sceneId },
    data: { status: "failed", errorMessage: errorMsg },
  });
}
