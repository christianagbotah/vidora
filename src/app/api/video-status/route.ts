import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";

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
    const { sceneId } = await req.json();

    if (!sceneId) {
      return NextResponse.json(
        { success: false, error: "sceneId is required" },
        { status: 400 }
      );
    }

    const scene = await db.videoScene.findUnique({ where: { id: sceneId } });

    if (!scene) {
      return NextResponse.json(
        { success: false, error: "Scene not found" },
        { status: 404 }
      );
    }

    // Already completed
    if (scene.videoUrl) {
      return NextResponse.json({
        success: true,
        status: "completed",
        videoUrl: scene.videoUrl,
        imageUrl: scene.imageUrl,
      });
    }

    // Failed
    if (scene.status === "failed") {
      return NextResponse.json({
        success: true,
        status: "failed",
      });
    }

    // No task started
    if (!scene.taskId) {
      return NextResponse.json({
        success: true,
        status: "no_task",
      });
    }

    // Poll the async result
    const zai = await ZAI.create();
    const result = await zai.async.result.query(scene.taskId);
    const taskStatus = result.task_status;

    if (taskStatus === "SUCCESS") {
      const videoUrl = extractVideoUrl(result as unknown as Record<string, unknown>);
      if (videoUrl) {
        await db.videoScene.update({
          where: { id: sceneId },
          data: { videoUrl, status: "completed" },
        });
        return NextResponse.json({
          success: true,
          status: "completed",
          videoUrl,
          imageUrl: scene.imageUrl,
        });
      }
      await db.videoScene.update({
        where: { id: sceneId },
        data: { status: "failed" },
      });
      return NextResponse.json({
        success: true,
        status: "failed",
      });
    }

    if (taskStatus === "FAIL") {
      await db.videoScene.update({
        where: { id: sceneId },
        data: { status: "failed" },
      });
      return NextResponse.json({
        success: true,
        status: "failed",
      });
    }

    // Still processing
    return NextResponse.json({
      success: true,
      status: "processing",
      taskId: scene.taskId,
    });
  } catch (error) {
    console.error("Failed to check video status:", error);
    return NextResponse.json(
      { success: false, error: "Failed to check video status" },
      { status: 500 }
    );
  }
}
