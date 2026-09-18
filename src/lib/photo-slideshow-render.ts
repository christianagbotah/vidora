import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { mkdir, rm } from "fs/promises";
import { db } from "@/lib/db";
import {
  generatedStoreDir,
  promoteGeneratedFile,
  resolvePublicAssetPath,
} from "@/lib/generated-store";
import {
  photoSlideshowSourceSignature,
  photoSlideshowSourceUrl,
  slideshowMotionForIndex,
  slideshowVideoFilter,
  type PhotoSlideshowSourceScene,
} from "@/lib/photo-slideshow-plan";

const execFileAsync = promisify(execFile);

interface PhotoSlideshowJobParams {
  mode?: string;
  expectedSourceSignature?: string;
}

interface RenderedScene {
  sceneId: string;
  oldVideoUrl: string | null;
  videoUrl: string;
  filePath: string;
}

function parseParams(raw: string | null): PhotoSlideshowJobParams {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as PhotoSlideshowJobParams;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function sceneRows(
  scenes: Array<{
    id: string;
    sceneNumber: number;
    referenceImageUrl: string | null;
    imageUrl: string | null;
    duration: number;
    transition: string;
  }>,
): PhotoSlideshowSourceScene[] {
  return scenes.map((scene) => ({
    id: scene.id,
    sceneNumber: scene.sceneNumber,
    referenceImageUrl: scene.referenceImageUrl,
    imageUrl: scene.imageUrl,
    duration: scene.duration,
    transition: scene.transition,
  }));
}

async function renderStillScene(input: {
  sourcePath: string;
  outputPath: string;
  aspectRatio: string;
  duration: number;
  sceneIndex: number;
}): Promise<void> {
  const motion = slideshowMotionForIndex(input.sceneIndex);
  const filter = slideshowVideoFilter(input.aspectRatio, input.duration, motion);
  const timeout = Math.max(45_000, Math.ceil(input.duration * 12_000));

  await execFileAsync(
    "ffmpeg",
    [
      "-nostdin",
      "-y",
      "-loglevel", "error",
      "-loop", "1",
      "-framerate", "24",
      "-i", input.sourcePath,
      "-vf", filter,
      "-t", String(input.duration),
      "-an",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      input.outputPath,
    ],
    { timeout, maxBuffer: 2 * 1024 * 1024 },
  );

  if (!existsSync(input.outputPath)) {
    throw new Error("FFmpeg completed without creating a slideshow clip");
  }
}

async function removePromoted(files: string[]): Promise<void> {
  await Promise.all(files.map((file) => rm(file, { force: true }).catch(() => undefined)));
}

async function removeSupersededClip(url: string | null, replacementUrl: string): Promise<void> {
  if (!url || url === replacementUrl || !url.startsWith("/generated/photo-slideshow-")) return;
  try {
    const stillReferenced = await db.videoScene.count({ where: { videoUrl: url } });
    if (stillReferenced > 0) return;
    await rm(resolvePublicAssetPath(url), { force: true });
  } catch (error) {
    console.warn(
      `[photo-slideshow] old clip cleanup skipped url=${url}:`,
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

export async function runPhotoSlideshowJob(jobId: string): Promise<void> {
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const promotedPaths: string[] = [];
  let workDir = "";

  try {
    const job = await db.exportJob.findUnique({ where: { id: jobId } });
    if (!job || job.status === "done" || job.status === "failed") return;

    const params = parseParams(job.params);
    if (params.mode !== "photo_slideshow" || !params.expectedSourceSignature) {
      throw new Error("Export job is not a Photo Studio slideshow render");
    }

    const project = await db.videoProject.findUnique({
      where: { id: job.projectId },
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
            videoUrl: true,
            duration: true,
            transition: true,
          },
        },
      },
    });
    if (!project || project.projectType !== "photo-slideshow") {
      throw new Error("Photo slideshow project not found");
    }
    if (project.scenes.length === 0) {
      throw new Error("Photo slideshow has no scenes");
    }

    const sourceScenes = sceneRows(project.scenes);
    const initialSignature = photoSlideshowSourceSignature({
      projectId: project.id,
      aspectRatio: project.aspectRatio,
      scenes: sourceScenes,
    });
    if (initialSignature !== params.expectedSourceSignature) {
      throw new Error("Photo slideshow sources changed before rendering started");
    }

    const sources = sourceScenes.map((scene) => {
      const sourceUrl = photoSlideshowSourceUrl(scene);
      if (!sourceUrl?.startsWith("/generated/")) {
        throw new Error(`Scene ${scene.sceneNumber} does not have a local Photo Studio source image`);
      }
      const sourcePath = resolvePublicAssetPath(sourceUrl);
      if (!existsSync(sourcePath)) {
        throw new Error(`Scene ${scene.sceneNumber} source image is missing from storage`);
      }
      return { scene, sourcePath };
    });

    workDir = path.join(generatedStoreDir(), `.photo-slideshow-${jobId}`);
    await rm(workDir, { recursive: true, force: true });
    await mkdir(workDir, { recursive: true });

    await db.exportJob.update({
      where: { id: jobId },
      data: {
        status: "running",
        progress: 3,
        step: "Preparing local slideshow render…",
        error: null,
        updatedAt: new Date(),
      },
    });

    heartbeat = setInterval(() => {
      db.exportJob
        .update({ where: { id: jobId }, data: { updatedAt: new Date() } })
        .catch(() => undefined);
    }, 10_000);

    const rendered: RenderedScene[] = [];
    for (let index = 0; index < sources.length; index++) {
      const { scene, sourcePath } = sources[index];
      const pct = Math.max(5, Math.round(5 + (index / sources.length) * 78));
      await db.exportJob.update({
        where: { id: jobId },
        data: {
          status: "running",
          progress: pct,
          step: `Animating photo ${index + 1} of ${sources.length} locally…`,
          updatedAt: new Date(),
        },
      });

      const tempPath = path.join(workDir, `scene-${String(index + 1).padStart(3, "0")}.mp4`);
      await renderStillScene({
        sourcePath,
        outputPath: tempPath,
        aspectRatio: project.aspectRatio,
        duration: Math.max(3, Math.min(10, scene.duration)),
        sceneIndex: index,
      });

      const fileName = `photo-slideshow-${project.id}-${scene.id}-${jobId}.mp4`;
      const promoted = await promoteGeneratedFile(tempPath, fileName);
      promotedPaths.push(promoted.path);
      rendered.push({
        sceneId: scene.id,
        oldVideoUrl: project.scenes[index].videoUrl,
        videoUrl: promoted.url,
        filePath: promoted.path,
      });
    }

    await db.exportJob.update({
      where: { id: jobId },
      data: {
        progress: 88,
        step: "Finalizing slideshow scenes…",
        updatedAt: new Date(),
      },
    });

    await db.$transaction(async (tx) => {
      const fresh = await tx.videoProject.findUnique({
        where: { id: project.id },
        select: {
          id: true,
          aspectRatio: true,
          projectType: true,
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
      if (!fresh || fresh.projectType !== "photo-slideshow") {
        throw new Error("Photo slideshow project changed before finalization");
      }
      const finalSignature = photoSlideshowSourceSignature({
        projectId: fresh.id,
        aspectRatio: fresh.aspectRatio,
        scenes: sceneRows(fresh.scenes),
      });
      if (finalSignature !== params.expectedSourceSignature) {
        throw new Error("Photo slideshow sources changed while rendering");
      }

      // Release the project-wide media lock inside the same transaction that
      // changes the visual cut. PostgreSQL still exposes the old active lock to
      // concurrent transactions until commit, while our own scene triggers can
      // see the cleared key and safely advance cutVersion for these new clips.
      await tx.exportJob.update({
        where: { id: jobId },
        data: { activeKey: null, progress: 92, step: "Saving local slideshow clips…" },
      });

      for (const clip of rendered) {
        await tx.videoScene.update({
          where: { id: clip.sceneId },
          data: {
            videoUrl: clip.videoUrl,
            taskId: null,
            status: "completed",
            errorMessage: null,
          },
        });
      }

      await tx.videoProject.update({
        where: { id: project.id },
        data: { status: "completed", finalVideoUrl: null },
      });

      await tx.exportJob.update({
        where: { id: jobId },
        data: {
          status: "done",
          activeKey: null,
          progress: 100,
          step: "Local slideshow clips ready",
          result: JSON.stringify({
            success: true,
            sceneCount: rendered.length,
            providerCostUsd: 0,
            creditsCharged: 0,
            message: `Rendered ${rendered.length} photo scene${rendered.length === 1 ? "" : "s"} locally with FFmpeg. No AI credits were used.`,
          }),
          error: null,
          updatedAt: new Date(),
        },
      });
    });

    await Promise.all(
      rendered.map((clip) => removeSupersededClip(clip.oldVideoUrl, clip.videoUrl)),
    );
  } catch (error) {
    console.error(
      `[photo-slideshow] job=${jobId} failed:`,
      error instanceof Error ? error.message : error,
    );
    await removePromoted(promotedPaths);
    await db.exportJob
      .update({
        where: { id: jobId },
        data: {
          status: "failed",
          activeKey: null,
          step: "Local slideshow render failed",
          error: error instanceof Error ? error.message : "Could not render the local slideshow",
          updatedAt: new Date(),
        },
      })
      .catch(() => undefined);
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
