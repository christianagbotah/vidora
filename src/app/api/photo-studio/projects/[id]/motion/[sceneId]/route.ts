import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/project-auth";
import {
  buildDirectedPhotoPrompt,
  resolvePhotoMotionDirection,
} from "@/lib/photo-studio-motion";

export const runtime = "nodejs";

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function activeExportResponse(error: unknown): NextResponse | null {
  if (!errorText(error).includes("VIDORA_EXPORT_ACTIVE")) return null;
  return NextResponse.json(
    {
      success: false,
      error: "Motion direction cannot change while an export or preview render is active.",
      code: "VIDORA_EXPORT_ACTIVE",
    },
    { status: 409 },
  );
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sceneId: string }> },
) {
  try {
    const { id, sceneId } = await params;
    const access = await requireProjectAccess(id, true);
    if (!access.ok) return access.response;

    const [project, activeRun, scene] = await Promise.all([
      db.videoProject.findUnique({
        where: { id },
        select: { id: true, projectType: true },
      }),
      db.generationRun.findUnique({
        where: { activeKey: `project:${id}` },
        select: { id: true, status: true },
      }),
      db.videoScene.findFirst({
        where: { id: sceneId, projectId: id },
        select: {
          id: true,
          prompt: true,
          status: true,
          videoUrl: true,
          taskId: true,
        },
      }),
    ]);

    if (!project) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }
    if (project.projectType !== "photo-animation") {
      return NextResponse.json(
        { success: false, error: "Motion Director is available only for Living Photo projects." },
        { status: 409 },
      );
    }
    if (!scene) {
      return NextResponse.json({ success: false, error: "Scene not found in this project" }, { status: 404 });
    }
    if (activeRun) {
      return NextResponse.json(
        {
          success: false,
          error: "Motion direction is locked while paid Living Photo generation is active.",
          code: "PHOTO_STUDIO_GENERATION_ACTIVE",
          generationRunId: activeRun.id,
        },
        { status: 409 },
      );
    }

    const immutableStatuses = new Set(["queued", "submitting", "generating"]);
    if (scene.videoUrl || scene.taskId || immutableStatuses.has(scene.status)) {
      return NextResponse.json(
        {
          success: false,
          error: "This scene has already entered generation. Review or regenerate it from Vidora Studio instead.",
          code: "PHOTO_STUDIO_SCENE_GENERATED",
        },
        { status: 409 },
      );
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    let direction: ReturnType<typeof resolvePhotoMotionDirection>;
    try {
      direction = resolvePhotoMotionDirection(body.preset, body.customDirection);
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Invalid motion direction",
          code: "PHOTO_STUDIO_MOTION_INVALID",
        },
        { status: 400 },
      );
    }

    const enhancedPrompt = buildDirectedPhotoPrompt(scene.prompt, direction);
    const updated = await db.$transaction(async (tx) => {
      const currentRun = await tx.generationRun.findUnique({
        where: { activeKey: `project:${id}` },
        select: { id: true },
      });
      if (currentRun) {
        throw new Error("PHOTO_STUDIO_GENERATION_ACTIVE");
      }

      const updatedScene = await tx.videoScene.update({
        where: { id: scene.id },
        data: {
          enhancedPrompt,
          cameraMove: direction.cameraMove,
          errorMessage: null,
          status: "pending",
        },
      });
      await tx.videoProject.update({
        where: { id },
        data: { finalVideoUrl: null, status: "draft" },
      });
      return updatedScene;
    });

    return NextResponse.json({
      success: true,
      scene: updated,
      motion: {
        preset: direction.preset,
        label: direction.label,
        cameraMove: direction.cameraMove,
      },
      providerCostUsd: 0,
      creditsRequired: 0,
    });
  } catch (error) {
    const guarded = activeExportResponse(error);
    if (guarded) return guarded;
    if (errorText(error).includes("PHOTO_STUDIO_GENERATION_ACTIVE")) {
      return NextResponse.json(
        {
          success: false,
          error: "Motion direction is locked while paid Living Photo generation is active.",
          code: "PHOTO_STUDIO_GENERATION_ACTIVE",
        },
        { status: 409 },
      );
    }
    console.error("[photo-studio motion PUT]", error);
    return NextResponse.json(
      { success: false, error: "Unable to save Living Photo motion direction" },
      { status: 500 },
    );
  }
}
