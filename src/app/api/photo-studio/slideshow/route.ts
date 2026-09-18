import { existsSync } from "fs";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { resolvePublicAssetPath } from "@/lib/generated-store";
import { mediaJobMode } from "@/lib/media-job-mode";
import { requireProjectAccess } from "@/lib/project-auth";
import {
  photoSlideshowSourceSignature,
  photoSlideshowSourceUrl,
} from "@/lib/photo-slideshow-plan";

export const runtime = "nodejs";

function activePreparationResponse(job: {
  id: string;
  status: string;
  progress: number;
  step: string;
  params: string | null;
}) {
  const mode = mediaJobMode(job.params);
  if (mode === "photo_slideshow") {
    return NextResponse.json({
      success: true,
      resumed: true,
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      step: job.step,
      usesAiCredits: false,
    });
  }
  return NextResponse.json(
    {
      success: false,
      error: mode === "preview"
        ? "Full Preview is currently running. Finish it before rebuilding local slideshow clips."
        : "A final export is currently active. Finish it before rebuilding local slideshow clips.",
      code: "VIDORA_MEDIA_JOB_ACTIVE",
    },
    { status: 409 },
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
    if (!projectId) {
      return NextResponse.json({ success: false, error: "Project ID is required" }, { status: 400 });
    }

    const access = await requireProjectAccess(projectId, true);
    if (!access.ok) return access.response;

    const project = await db.videoProject.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        projectType: true,
        aspectRatio: true,
        scenes: {
          orderBy: { sceneNumber: "asc" },
          select: {
            id: true,
            sceneNumber: true,
            referenceImageUrl: true,
            imageUrl: true,
            duration: true,
            transition: true,
          },
        },
      },
    });
    if (!project || project.projectType !== "photo-slideshow") {
      return NextResponse.json(
        { success: false, error: "This project is not a Photo Studio slideshow" },
        { status: 400 },
      );
    }
    if (!project.scenes.length) {
      return NextResponse.json({ success: false, error: "Add at least one photo first" }, { status: 400 });
    }

    const sourceUrls: string[] = [];
    for (const scene of project.scenes) {
      const sourceUrl = photoSlideshowSourceUrl(scene);
      if (!sourceUrl?.startsWith("/generated/")) {
        return NextResponse.json(
          { success: false, error: `Photo ${scene.sceneNumber} does not have a durable local source image` },
          { status: 409 },
        );
      }
      const sourcePath = resolvePublicAssetPath(sourceUrl);
      if (!existsSync(sourcePath)) {
        return NextResponse.json(
          { success: false, error: `Photo ${scene.sceneNumber} is missing from storage. Upload it again before rendering.` },
          { status: 409 },
        );
      }
      sourceUrls.push(sourceUrl);
    }

    const uniqueSourceUrls = [...new Set(sourceUrls)];
    const ownedAssets = await db.mediaAsset.findMany({
      where: {
        userId: access.session.userId,
        kind: "image",
        url: { in: uniqueSourceUrls },
      },
      select: { url: true },
    });
    if (ownedAssets.length !== uniqueSourceUrls.length) {
      return NextResponse.json(
        { success: false, error: "One or more slideshow photos are not owned by this account" },
        { status: 403 },
      );
    }

    const activeKey = `project:${projectId}`;
    const active = await db.exportJob.findUnique({ where: { activeKey } });
    if (active) return activePreparationResponse(active);

    const expectedSourceSignature = photoSlideshowSourceSignature({
      projectId: project.id,
      aspectRatio: project.aspectRatio,
      scenes: project.scenes,
    });

    try {
      const job = await db.exportJob.create({
        data: {
          projectId,
          userId: access.session.userId === "guest" ? null : access.session.userId,
          activeKey,
          status: "queued",
          progress: 0,
          step: "Queued local slideshow render",
          params: JSON.stringify({
            mode: "photo_slideshow",
            expectedSourceSignature,
            providerCostUsd: 0,
            creditsRequired: 0,
          }),
        },
      });

      return NextResponse.json({
        success: true,
        jobId: job.id,
        usesAiCredits: false,
        providerCostUsd: 0,
        creditsRequired: 0,
        message: "Local slideshow rendering queued. No AI credits will be used.",
      }, { status: 202 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const concurrent = await db.exportJob.findUnique({ where: { activeKey } });
        if (concurrent) return activePreparationResponse(concurrent);
      }
      throw error;
    }
  } catch (error) {
    console.error("[photo-slideshow] failed to queue local render", error);
    return NextResponse.json(
      { success: false, error: "Could not start the local slideshow render" },
      { status: 500 },
    );
  }
}
