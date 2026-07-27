import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { zai } from "@/lib/zai";
import { requireProjectAccess } from "@/lib/project-auth";
import { zaiErrorResponse } from "@/lib/zai-errors";
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
    // Verify the user owns (or admin can view) the project before generating
    if (projectId) {
      const authResult = await requireProjectAccess(projectId, true); // write access
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

    // Step 1: Generate thumbnail image if scene doesn't have one
    let imageUrl: string | null = null;
    const sceneData = await db.videoScene.findUnique({ where: { id: sceneId }, select: { imageUrl: true } });
    if (!sceneData?.imageUrl) {
      try {
        const imageBase64 = await zai.generateImage({
          prompt,
          size: thumbSize as "1024x1024" | "768x1344" | "864x1152" | "1344x768" | "1152x864" | "1440x720" | "720x1440",
          retry: { label: "Thumbnail generation", timeoutMs: 120_000, maxRetries: 4 },
        });
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

    // Step 2: Create video generation task via centralized wrapper
    const taskId = await zai.generateVideo({
      prompt,
      size: videoSize,
      duration: duration || 10,
      quality: "quality",
      withAudio: false,
      ...(referenceImage ? { imageUrl: referenceImage } : {}),
      retry: { label: "Video generation task", timeoutMs: 120_000, maxRetries: 4 },
    });

    console.log(`Video generation task created: ${taskId}`);

    // Update scene status
    await db.videoScene.update({
      where: { id: sceneId },
      data: { taskId, status: "generating" },
    });

    // Step 3: Poll for video result via centralized wrapper
    const result = await zai.pollVideoTask({
      taskId,
      maxAttempts: 80,
      intervalMs: 15_000,
    });

    if (result.status === "success" && result.videoUrl) {
      await db.videoScene.update({
        where: { id: sceneId },
        data: { videoUrl: result.videoUrl, status: "completed" },
      });
      console.log(`Video ready: ${result.videoUrl.slice(0, 80)}...`);
      return NextResponse.json({
        success: true,
        videoUrl: result.videoUrl,
        taskId,
        imageUrl,
      });
    }

    if (result.status === "timeout") {
      // Timeout — keep as generating so frontend can still poll via video-status
      console.warn(`Video generation timed out for task: ${taskId}`);
      return NextResponse.json({
        success: true,
        taskId,
        imageUrl,
        status: "processing",
        message: "Video is still being generated. It will be available shortly.",
      });
    }

    // Failed
    await db.videoScene.update({
      where: { id: sceneId },
      data: { status: "failed" },
    });
    return NextResponse.json({
      success: false,
      error: result.error || "Video generation failed on the server",
    });
  } catch (error) {
    const session = await getServerSession(authOptions).catch(() => null);
    return zaiErrorResponse(error, {
      session,
      logLabel: "generate-video-scene",
    });
  }
}
