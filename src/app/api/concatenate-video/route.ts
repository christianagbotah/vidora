import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/project-auth";
import { generatedStoreDir, generatedFilePath, resolvePublicAssetPath } from "@/lib/generated-store";
import {
  renderFullProjectPreview,
  type FullPreviewTransition,
} from "@/lib/full-preview-render";
import { writeFile, mkdir, rm, readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const PREVIEW_TRANSITIONS = new Set<FullPreviewTransition>(["fade", "dissolve", "wipe", "slide", "cut"]);

async function checkFfmpeg(): Promise<boolean> {
  try {
    await execFileAsync("which", ["ffmpeg"]);
    await execFileAsync("which", ["ffprobe"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Persist review only if the project render inputs are still exactly the ones
 * that were loaded before preview rendering began. PostgreSQL increments
 * cutVersion for visual changes plus dialogue/voice/music source changes.
 */
async function markCurrentCutReviewed(projectId: string, expectedCutVersion: number): Promise<void> {
  const result = await db.videoProject.updateMany({
    where: { id: projectId, cutVersion: expectedCutVersion },
    data: { reviewedCutVersion: expectedCutVersion, reviewedAt: new Date() },
  });
  if (result.count !== 1) {
    throw new Error("Project changed while the full preview was being built");
  }
}

function previewFailureStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  if (/changed while|changed before|requires every scene/i.test(message)) return 409;
  return 502;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      projectId,
      previewOnly = false,
      withTitleCard = false,
      includeAudio = true,
    } = body;
    const transitionRaw = typeof body.transition === "string" ? body.transition : "fade";
    const transition: FullPreviewTransition = PREVIEW_TRANSITIONS.has(transitionRaw as FullPreviewTransition)
      ? transitionRaw as FullPreviewTransition
      : "fade";

    if (!projectId) {
      return NextResponse.json({ success: false, error: "Project ID is required" }, { status: 400 });
    }

    const authResult = await requireProjectAccess(projectId, true);
    if (!authResult.ok) return authResult.response;

    const hasFfmpeg = await checkFfmpeg();
    if (!hasFfmpeg) {
      return NextResponse.json(
        { success: false, error: "ffmpeg/ffprobe is not installed on the server." },
        { status: 500 },
      );
    }

    const project = await db.videoProject.findUnique({
      where: { id: projectId },
      include: { scenes: { orderBy: { sceneNumber: "asc" } } },
    });
    if (!project) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }

    const completedScenes = project.scenes.filter((scene) => scene.videoUrl);
    if (completedScenes.length === 0) {
      return NextResponse.json({ success: false, error: "No completed video scenes to concatenate" }, { status: 400 });
    }

    if (previewOnly) {
      if (completedScenes.length !== project.scenes.length) {
        return NextResponse.json({
          success: false,
          error: `Full preview requires every scene to be complete (${completedScenes.length}/${project.scenes.length} ready).`,
        }, { status: 409 });
      }

      const activeExport = await db.exportJob.findUnique({ where: { activeKey: `project:${projectId}` } });
      if (activeExport) {
        return NextResponse.json({
          success: false,
          error: "A final export is already queued or running. Review can be refreshed after it finishes.",
          code: "VIDORA_EXPORT_ACTIVE",
        }, { status: 409 });
      }

      const expectedCutVersion = project.cutVersion;
      try {
        const preview = await renderFullProjectPreview(projectId, expectedCutVersion, {
          transition,
          withTitleCard: withTitleCard === true,
          includeAudio: includeAudio !== false,
        });
        await markCurrentCutReviewed(projectId, expectedCutVersion);
        const min = Math.floor(preview.durationSeconds / 60);
        const sec = Math.round(preview.durationSeconds % 60);
        const duration = min > 0 ? `${min}m ${sec}s` : `${sec}s`;
        return NextResponse.json({
          success: true,
          previewVideoUrl: preview.previewVideoUrl,
          sceneCount: preview.sceneCount,
          reviewedCutVersion: expectedCutVersion,
          estimatedDuration: duration,
          render: {
            transition: preview.transition,
            withTitleCard: preview.withTitleCard,
            includeAudio: preview.includeAudio,
            voices: preview.voices,
            musicScenes: preview.musicScenes,
            ambienceScenes: preview.ambienceScenes,
          },
          message: "Full project preview ready with current dialogue, music, ambience, and transitions.",
        });
      } catch (error) {
        console.error("Full preview render failed:", error);
        return NextResponse.json({
          success: false,
          error: "Could not build the current full preview. Dialogue/audio generation or video assembly failed; nothing was approved.",
        }, { status: previewFailureStatus(error) });
      }
    }

    // ── Legacy direct concatenate path ────────────────────────────────────
    // Kept for backward compatibility. Production export uses /api/export-video
    // and remains protected by the database review trigger.
    if (completedScenes.length === 1) {
      await db.videoProject.update({
        where: { id: projectId },
        data: { finalVideoUrl: completedScenes[0].videoUrl, status: "completed" },
      });
      return NextResponse.json({
        success: true,
        finalVideoUrl: completedScenes[0].videoUrl,
        sceneCount: 1,
        message: "Single scene saved as final video",
      });
    }

    await db.videoProject.update({ where: { id: projectId }, data: { status: "generating" } });
    const workDir = path.join(generatedStoreDir(), "concat_" + projectId);
    await mkdir(workDir, { recursive: true });

    try {
      const localPaths: string[] = [];
      for (let index = 0; index < completedScenes.length; index++) {
        const scene = completedScenes[index];
        const localPath = path.join(workDir, "scene_" + String(index + 1).padStart(3, "0") + ".mp4");
        try {
          const response = await fetch(scene.videoUrl!);
          if (!response.ok) throw new Error("Failed to download: HTTP " + response.status);
          await writeFile(localPath, Buffer.from(await response.arrayBuffer()));
          localPaths.push(localPath);
        } catch (downloadError) {
          console.error("Failed to download scene " + (index + 1) + ":", downloadError);
          const localFile = resolvePublicAssetPath(scene.videoUrl!);
          if (existsSync(localFile)) localPaths.push(localFile);
        }
      }

      if (localPaths.length < 2) {
        throw new Error("Only " + localPaths.length + " clips could be downloaded. Need at least 2 to concatenate.");
      }

      const concatListPath = path.join(workDir, "concat.txt");
      await writeFile(concatListPath, localPaths.map((item) => "file '" + item + "'").join("\n"));
      const outputPath = path.join(workDir, "final.mp4");

      let concatSucceeded = false;
      try {
        await execFileAsync(
          "ffmpeg",
          ["-nostdin", "-y", "-f", "concat", "-safe", "0", "-i", concatListPath, "-c", "copy", outputPath],
          { timeout: 120_000 },
        );
        concatSucceeded = existsSync(outputPath);
      } catch {
        console.log("Concat demuxer failed, falling back to re-encode");
      }

      if (!concatSucceeded) {
        await execFileAsync(
          "ffmpeg",
          [
            "-nostdin", "-y", "-f", "concat", "-safe", "0", "-i", concatListPath,
            "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-r", "24",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", outputPath,
          ],
          { timeout: 600_000 },
        );
        if (!existsSync(outputPath)) throw new Error("ffmpeg concat failed");
      }

      const resultFileName = "final_" + projectId + ".mp4";
      const resultPath = generatedFilePath(resultFileName);
      await mkdir(path.dirname(resultPath), { recursive: true });
      await writeFile(resultPath, await readFile(outputPath));
      const resultVideoUrl = "/generated/" + resultFileName;

      await db.videoProject.update({
        where: { id: projectId },
        data: { finalVideoUrl: resultVideoUrl, status: "completed" },
      });
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);

      return NextResponse.json({
        success: true,
        finalVideoUrl: resultVideoUrl,
        sceneCount: completedScenes.length,
        message: "Full video created!",
      });
    } catch (error) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      await db.videoProject.update({ where: { id: projectId }, data: { status: "failed" } }).catch(() => undefined);
      console.error("Legacy concatenate failed:", error);
      return NextResponse.json({ success: false, error: "Failed to concatenate videos" }, { status: 500 });
    }
  } catch (error) {
    console.error("Concatenate error:", error);
    return NextResponse.json({ success: false, error: "Failed to concatenate videos" }, { status: 500 });
  }
}
