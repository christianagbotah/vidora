import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { zai, ZAIError } from "@/lib/zai";
import { friendlySceneError } from "@/lib/zai-errors";
import { requireProjectAccess } from "@/lib/project-auth";
import { resolveModelForRequest } from "@/lib/video-models";
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

    // Get the project for aspect ratio, style, scene/character context, and
    // the project's selected video engine (model)
    let aspectRatio = "16:9";
    let projectStyle: string | null = null;
    let videoModel: string | null = null;
    let referenceImage: string | undefined;
    // Character-aware prompts — fallback to the raw client prompt when the
    // project/scene can't be loaded (prompt-only generation).
    let videoPrompt = prompt;
    let imagePrompt = prompt;

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
        projectStyle = project.style;
        videoModel = project.videoModel ?? null;

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

        // ── Character-aware prompts ──
        // Merge the characters' full appearance descriptions into the
        // prompts so the generated thumbnail/video actually match the
        // described characters (e.g. "JJ, the toddler star of CoComelon…").
        videoPrompt = buildSceneVideoPrompt({
          scenePrompt: prompt,
          characters: project.characters,
          linkedCharacterIds: scene?.characterIds,
        });
        imagePrompt = buildSceneImagePrompt({
          scenePrompt: prompt,
          style: projectStyle,
          characters: project.characters,
          linkedCharacterIds: scene?.characterIds,
        });
      }
    }

    const videoSize = VIDEO_SIZE_MAP[aspectRatio] || "1920x1080";
    const thumbSize = THUMB_SIZE_MAP[aspectRatio] || "1344x768";

    // Resolve the reference image to an absolute URL the ZAI API can
    // fetch (local /generated/... paths are unreachable from the API).
    // Orientation normalization happens INSIDE the background task
    // (see runSceneGeneration) so this response stays fast.
    const origin = publicOrigin(req);

    // Mark generating right away so the client's status polling sees it
    await db.videoScene.update({
      where: { id: sceneId },
      data: { status: "generating", errorMessage: null },
    }).catch(() => { /* scene may not exist yet client-side */ });

    // ── Fire-and-forget: everything below runs in the background ──
    console.log(`[generate-video-scene] scene=${sceneId} model=${resolveModelForRequest(videoModel, Boolean(referenceImage))} videoPrompt="${videoPrompt.slice(0, 120)}${videoPrompt.length > 120 ? "…" : ""}" imagePromptLen=${imagePrompt.length}`);
    void runSceneGeneration({
      prompt: videoPrompt,
      imagePrompt,
      sceneId,
      duration: duration || 10,
      videoSize,
      thumbSize,
      referenceImage,
      origin,
      aspectRatio,
      style: projectStyle,
      videoModel,
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

/** Background worker: video task FIRST (starts generating in seconds),
 * then thumbnail in parallel while the video renders, then poll. */
async function runSceneGeneration(opts: {
  prompt: string;
  /** Character-aware prompt for the thumbnail (may differ from the video prompt). */
  imagePrompt: string;
  sceneId: string;
  duration: number;
  videoSize: string;
  thumbSize: string;
  /** LOCAL reference image path (if any) — normalized + absolutized below. */
  referenceImage?: string;
  /** Public origin — used to build the absolute reference URL. */
  origin: string;
  /** Project aspect ratio — sent natively to Vidu models. */
  aspectRatio?: string;
  /** Project style — mapped to the viduq1-text style enum. */
  style?: string | null;
  /** Project's selected video engine (null = default CogVideoX-3). */
  videoModel?: string | null;
}): Promise<void> {
  const { prompt, imagePrompt, sceneId, duration, videoSize, thumbSize, aspectRatio, style, videoModel, origin } = opts;

  // Step 1: Create the video generation task FIRST — this is the moment
  // "generation actually starts" (a few seconds). The thumbnail is NOT an
  // input to the video task, so it runs in parallel below instead of
  // blocking task creation for 30-60s.
  //
  // Orientation guard FIRST: image-to-video engines follow the INPUT
  // image's orientation — a mismatched reference (legacy square portrait,
  // landscape upload) is center-cropped to the project's aspect ratio.
  let referenceImage: string | undefined;
  if (opts.referenceImage) {
    const normalized = await ensureReferenceAspect(
      opts.referenceImage,
      aspectRatio || "16:9",
      `scene=${sceneId.slice(0, 8)}`
    );
    referenceImage = toAbsoluteUrl(normalized, origin) ?? undefined;
  }

  let taskId: string;
  try {
    // Per-scene model resolution: image-dependent models substitute their
    // text-capable sibling when no reference image is available.
    // withAudio: CogVideoX-3 renders native ambient sound (Vidu models
    // omit the flag); character dialogue voices come from the TTS
    // narration auto-generated right after the clip completes.
    const model = resolveModelForRequest(videoModel, Boolean(referenceImage));
    taskId = await zai.generateVideo({
      prompt,
      size: videoSize,
      duration,
      quality: "quality",
      withAudio: true,
      ...(referenceImage ? { imageUrl: referenceImage } : {}),
      model,
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(style ? { style } : {}),
      retry: { label: "Video generation task", timeoutMs: 120_000, maxRetries: 2 },
    });
    if (model !== (videoModel ?? "CogVideoX-3")) {
      console.log(`[generate-video-scene] scene=${sceneId}: no reference image — model substituted ${videoModel ?? "default"} → ${model}`);
    }
  } catch (err) {
    const isRateLimit = err instanceof ZAIError && err.kind === "rate_limit";
    const rawMsg = err instanceof Error ? err.message : String(err);
    const errorMsg = isRateLimit
      ? "Video generation is currently rate-limited. Please wait a few minutes and try again."
      : friendlySceneError(rawMsg);

    await db.videoScene.update({
      where: { id: sceneId },
      data: { status: "failed", errorMessage: errorMsg },
    });
    console.error(`[generate-video-scene] task creation failed: ${rawMsg}`);
    return;
  }

  console.log(`[generate-video-scene] task created: ${taskId}`);

  await db.videoScene.update({
    where: { id: sceneId },
    data: { taskId, status: "generating", errorMessage: null },
  });

  // Step 2: Generate thumbnail in parallel (fire-and-forget) — it fills in
  // the scene preview while the video renders. Non-fatal on failure.
  const sceneData = await db.videoScene.findUnique({
    where: { id: sceneId },
    select: { imageUrl: true },
  });
  if (!sceneData?.imageUrl) {
    void (async () => {
      try {
        const imageBase64 = await zai.generateImage({
          prompt: imagePrompt,
          size: thumbSize as "1024x1024" | "768x1344" | "864x1152" | "1344x768" | "1152x864" | "1440x720" | "720x1440",
          retry: { label: "Thumbnail generation", timeoutMs: 120_000, maxRetries: 4 },
        });
        const buffer = Buffer.from(imageBase64, "base64");
        const filename = `thumb_${Date.now()}_${sceneId.slice(0, 8)}.png`;
        const imageUrl = await saveGeneratedFile(filename, buffer);
        await db.videoScene.update({ where: { id: sceneId }, data: { imageUrl } });
      } catch (imgErr) {
        console.error("Thumbnail generation failed (non-fatal):", imgErr);
      }
    })();
  }

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
    // Auto-generate the character voice for the dialogue (non-fatal,
    // fire-and-forget) so the studio clip has sound right away.
    void autoNarrateScene(sceneId);
    return;
  }

  if (result.status === "timeout") {
    // Leave in "generating" state — client polling + reload recovery
    // handle it; a future /api/video-status call could re-poll.
    console.warn(`[generate-video-scene] polling timed out for task: ${taskId}`);
    return;
  }

  // Failed
  const errorMsg = friendlySceneError(
    result.error || "Video generation failed on the server"
  );
  console.error(
    `[generate-video-scene] scene=${sceneId} task failed: ${result.error || errorMsg}`
  );
  await db.videoScene.update({
    where: { id: sceneId },
    data: { status: "failed", errorMessage: errorMsg },
  });
}
