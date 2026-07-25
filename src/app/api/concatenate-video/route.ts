import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeFile, mkdir, rm, readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

async function checkFfmpeg(): Promise<boolean> {
  try {
    await execAsync("which ffmpeg");
    return true;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    // Validate ffmpeg is available
    const hasFfmpeg = await checkFfmpeg();
    if (!hasFfmpeg) {
      return NextResponse.json(
        { success: false, error: "ffmpeg is not installed on the server. Please install ffmpeg (e.g. sudo apt install ffmpeg) to merge videos." },
        { status: 500 }
      );
    }

    const { projectId } = await req.json();
    if (!projectId) {
      return NextResponse.json({ success: false, error: "Project ID is required" }, { status: 400 });
    }

    const project = await db.videoProject.findUnique({
      where: { id: projectId },
      include: { scenes: { orderBy: { sceneNumber: "asc" } } },
    });
    if (!project) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }

    // Filter to scenes that have completed videos
    const completedScenes = project.scenes.filter((s) => s.videoUrl);
    if (completedScenes.length === 0) {
      return NextResponse.json({ success: false, error: "No completed video scenes to concatenate" }, { status: 400 });
    }

    if (completedScenes.length === 1) {
      // Just one scene — save as final video directly
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

    // Mark as generating
    await db.videoProject.update({ where: { id: projectId }, data: { status: "generating" } });

    const workDir = path.join(process.cwd(), "public", "generated", "concat_" + projectId);
    await mkdir(workDir, { recursive: true });

    try {
      // Download all video clips
      const localPaths: string[] = [];
      for (let i = 0; i < completedScenes.length; i++) {
        const scene = completedScenes[i];
        const localPath = path.join(workDir, "scene_" + String(i + 1).padStart(3, "0") + ".mp4");

        try {
          const response = await fetch(scene.videoUrl!);
          if (!response.ok) throw new Error("Failed to download: HTTP " + response.status);
          const buffer = Buffer.from(await response.arrayBuffer());
          await writeFile(localPath, buffer);
          localPaths.push(localPath);
        } catch (dlErr) {
          console.error("Failed to download scene " + (i + 1) + ":", dlErr);
          const localFile = path.join(process.cwd(), scene.videoUrl!);
          if (existsSync(localFile)) {
            localPaths.push(localFile);
          }
        }
      }

      if (localPaths.length < 2) {
        throw new Error("Only " + localPaths.length + " clips could be downloaded. Need at least 2 to concatenate.");
      }

      // Create ffmpeg concat file list
      const concatListPath = path.join(workDir, "concat.txt");
      const concatContent = localPaths.map((p) => "file '" + p + "'").join("\n");
      await writeFile(concatListPath, concatContent);

      const outputPath = path.join(workDir, "final.mp4");

      // Try concat demuxer first (no re-encode)
      let concatSucceeded = false;
      try {
        await execAsync(
          'ffmpeg -y -f concat -safe 0 -i "' + concatListPath + '" -c copy "' + outputPath + '"',
          { timeout: 120000 }
        );
        concatSucceeded = existsSync(outputPath);
      } catch (_e) {
        console.log("Concat demuxer failed, falling back to re-encode");
      }

      if (!concatSucceeded) {
        console.log("Concat demuxer failed (likely different codecs), re-encoding with libx264...");
        try {
          await execAsync(
            'ffmpeg -y -f concat -safe 0 -i "' + concatListPath + '" -c:v libx264 -preset fast -crf 23 -r 24 -pix_fmt yuv420p -c:a aac -movflags +faststart "' + outputPath + '"',
            { timeout: 600000 }
          );
        } catch (recodeErr) {
          const recodeMsg = recodeErr instanceof Error ? recodeErr.message : String(recodeErr);
          console.error("Re-encode concat also failed:", recodeMsg);
          throw new Error("ffmpeg could not merge the video clips. The clips may have incompatible formats. Details: " + recodeMsg.slice(0, 200));
        }
        if (!existsSync(outputPath)) {
          throw new Error("ffmpeg concat failed");
        }
      }

      // Move final video to public/generated
      const finalFileName = "final_" + projectId + ".mp4";
      const finalPath = path.join(process.cwd(), "public", "generated", finalFileName);
      const finalData = await readFile(outputPath);
      await writeFile(finalPath, finalData);

      const finalVideoUrl = "/generated/" + finalFileName;

      // Update project
      await db.videoProject.update({
        where: { id: projectId },
        data: { finalVideoUrl, status: "completed" },
      });

      // Clean up
      try { await rm(workDir, { recursive: true, force: true }); } catch (_e) { /* ignore */ }

      const durationSec = completedScenes.length * 10;
      const min = Math.floor(durationSec / 60);
      const sec = durationSec % 60;
      const durationStr = min > 0 ? min + "m " + sec + "s" : sec + "s";

      return NextResponse.json({
        success: true,
        finalVideoUrl,
        sceneCount: completedScenes.length,
        estimatedDuration: durationStr,
        message: "Full video created! (" + completedScenes.length + " scenes, ~" + durationStr + ")",
      });
    } catch (err) {
      try { await rm(workDir, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
      const msg = err instanceof Error ? err.message : "Unknown error";
      await db.videoProject.update({ where: { id: projectId }, data: { status: "failed" } });
      return NextResponse.json({ success: false, error: "Failed to concatenate videos: " + msg }, { status: 500 });
    }
  } catch (error) {
    console.error("Concatenate error:", error);
    return NextResponse.json({ success: false, error: "Failed to concatenate videos" }, { status: 500 });
  }
}
