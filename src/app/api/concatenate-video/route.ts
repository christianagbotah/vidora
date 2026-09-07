import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/project-auth";
import {
  generatedStoreDir,
  generatedFilePath,
  resolvePublicAssetPath,
} from "@/lib/generated-store";
import type { FullPreviewTransition } from "@/lib/full-preview-render";
import { writeFile, mkdir, rm, readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const PREVIEW_TRANSITIONS = new Set<FullPreviewTransition>([
  "fade",
  "dissolve",
  "wipe",
  "slide",
  "cut",
]);
const PREVIEW_STREAM_HEARTBEAT_MS = 10_000;
const PREVIEW_STREAM_POLL_MS = 1_000;
const PREVIEW_STREAM_MAX_MS = 20 * 60_000;

async function checkFfmpeg(): Promise<boolean> {
  try {
    await execFileAsync("which", ["ffmpeg"]);
    await execFileAsync("which", ["ffprobe"]);
    return true;
  } catch {
    return false;
  }
}

function jobMode(params: string | null): string {
  if (!params) return "final";
  try {
    const parsed = JSON.parse(params) as { mode?: unknown };
    return typeof parsed.mode === "string" ? parsed.mode : "final";
  } catch {
    return "final";
  }
}

function streamFullPreviewJob(jobId: string): Response {
  const encoder = new TextEncoder();
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const cleanup = () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (pollTimer) clearTimeout(pollTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    heartbeatTimer = null;
    pollTimer = null;
    timeoutTimer = null;
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (value: string): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(value));
          return true;
        } catch {
          closed = true;
          cleanup();
          return false;
        }
      };

      const finish = (payload: Record<string, unknown>) => {
        if (closed) return;
        const wrote = safeEnqueue(JSON.stringify(payload));
        closed = true;
        cleanup();
        if (wrote) {
          try {
            controller.close();
          } catch {
            // Client already disconnected; the durable preview job still runs.
          }
        }
      };

      // Commit headers/body immediately, then keep traffic flowing through
      // Cloudflare/Nginx while the durable worker performs TTS/media/FFmpeg.
      safeEnqueue("\n");
      heartbeatTimer = setInterval(() => {
        safeEnqueue("\n"); // legal leading JSON whitespace
      }, PREVIEW_STREAM_HEARTBEAT_MS);

      timeoutTimer = setTimeout(() => {
        finish({
          success: false,
          error: "Full preview is still processing in the background. Retry Full Preview to reconnect to the same job.",
          code: "VIDORA_PREVIEW_STILL_RUNNING",
          jobId,
        });
      }, PREVIEW_STREAM_MAX_MS);

      const poll = async () => {
        if (closed) return;
        try {
          const job = await db.exportJob.findUnique({ where: { id: jobId } });
          if (!job) {
            finish({ success: false, error: "Full preview job could not be found." });
            return;
          }

          if (job.status === "done") {
            try {
              const result = job.result ? JSON.parse(job.result) as Record<string, unknown> : null;
              if (!result) throw new Error("missing preview result");
              finish({ ...result, jobId });
            } catch {
              finish({ success: false, error: "Full preview finished without a readable result." });
            }
            return;
          }

          if (job.status === "failed") {
            finish({
              success: false,
              error: job.error || "Could not build the full project preview.",
              jobId,
            });
            return;
          }

          pollTimer = setTimeout(() => void poll(), PREVIEW_STREAM_POLL_MS);
        } catch {
          // A transient DB read failure should not kill a live worker job.
          pollTimer = setTimeout(() => void poll(), 1_500);
        }
      };

      void poll();
    },
    cancel() {
      closed = true;
      cleanup();
      // Do not cancel the database job: browser disconnects must not destroy
      // already-started provider/FFmpeg work. A retry resumes the active job.
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
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
    const transition: FullPreviewTransition = PREVIEW_TRANSITIONS.has(
      transitionRaw as FullPreviewTransition,
    )
      ? transitionRaw as FullPreviewTransition
      : "fade";

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: "Project ID is required" },
        { status: 400 },
      );
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
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 },
      );
    }

    const completedScenes = project.scenes.filter((scene) => scene.videoUrl);
    if (completedScenes.length === 0) {
      return NextResponse.json(
        { success: false, error: "No completed video scenes to concatenate" },
        { status: 400 },
      );
    }

    if (previewOnly) {
      if (completedScenes.length !== project.scenes.length) {
        return NextResponse.json(
          {
            success: false,
            error: `Full preview requires every scene to be complete (${completedScenes.length}/${project.scenes.length} ready).`,
          },
          { status: 409 },
        );
      }

      // Preview and final export share one active project lock. This preserves
      // review/export invariants and closes double-click/concurrent races.
      const activeKey = `project:${projectId}`;
      const activeJob = await db.exportJob.findUnique({ where: { activeKey } });
      if (activeJob) {
        if (jobMode(activeJob.params) === "preview") {
          return streamFullPreviewJob(activeJob.id);
        }
        return NextResponse.json(
          {
            success: false,
            error: "A final export is already queued or running. Review can be refreshed after it finishes.",
            code: "VIDORA_EXPORT_ACTIVE",
          },
          { status: 409 },
        );
      }

      let job;
      try {
        job = await db.exportJob.create({
          data: {
            projectId,
            userId:
              authResult.session.userId && authResult.session.userId !== "guest"
                ? authResult.session.userId
                : null,
            activeKey,
            status: "queued",
            progress: 0,
            step: "Queued full preview",
            params: JSON.stringify({
              mode: "preview",
              expectedCutVersion: project.cutVersion,
              transition,
              withTitleCard: withTitleCard === true,
              includeAudio: includeAudio !== false,
            }),
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const concurrent = await db.exportJob.findUnique({ where: { activeKey } });
          if (concurrent && jobMode(concurrent.params) === "preview") {
            return streamFullPreviewJob(concurrent.id);
          }
          if (concurrent) {
            return NextResponse.json(
              {
                success: false,
                error: "A final export is already queued or running.",
                code: "VIDORA_EXPORT_ACTIVE",
              },
              { status: 409 },
            );
          }
        }
        throw error;
      }

      return streamFullPreviewJob(job.id);
    }

    // ── Legacy direct concatenate path ────────────────────────────────────
    // Kept for backward compatibility. Production final export uses
    // /api/export-video and the durable export worker.
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

    await db.videoProject.update({
      where: { id: projectId },
      data: { status: "generating" },
    });
    const workDir = path.join(generatedStoreDir(), `concat_${projectId}`);
    await mkdir(workDir, { recursive: true });

    try {
      const localPaths: string[] = [];
      for (let index = 0; index < completedScenes.length; index++) {
        const scene = completedScenes[index];
        const localPath = path.join(
          workDir,
          `scene_${String(index + 1).padStart(3, "0")}.mp4`,
        );
        try {
          const response = await fetch(scene.videoUrl!);
          if (!response.ok) throw new Error(`Failed to download: HTTP ${response.status}`);
          await writeFile(localPath, Buffer.from(await response.arrayBuffer()));
          localPaths.push(localPath);
        } catch (downloadError) {
          console.error(`Failed to download scene ${index + 1}:`, downloadError);
          const localFile = resolvePublicAssetPath(scene.videoUrl!);
          if (existsSync(localFile)) localPaths.push(localFile);
        }
      }

      if (localPaths.length < 2) {
        throw new Error(
          `Only ${localPaths.length} clips could be downloaded. Need at least 2 to concatenate.`,
        );
      }

      const concatListPath = path.join(workDir, "concat.txt");
      await writeFile(
        concatListPath,
        localPaths.map((item) => `file '${item}'`).join("\n"),
      );
      const outputPath = path.join(workDir, "final.mp4");

      let concatSucceeded = false;
      try {
        await execFileAsync(
          "ffmpeg",
          [
            "-nostdin",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            concatListPath,
            "-c",
            "copy",
            outputPath,
          ],
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
            "-nostdin",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            concatListPath,
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "23",
            "-r",
            "24",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
            outputPath,
          ],
          { timeout: 600_000 },
        );
        if (!existsSync(outputPath)) throw new Error("ffmpeg concat failed");
      }

      const resultFileName = `final_${projectId}.mp4`;
      const resultPath = generatedFilePath(resultFileName);
      await mkdir(path.dirname(resultPath), { recursive: true });
      await writeFile(resultPath, await readFile(outputPath));
      const resultVideoUrl = `/generated/${resultFileName}`;

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
      await db.videoProject
        .update({ where: { id: projectId }, data: { status: "failed" } })
        .catch(() => undefined);
      console.error("Legacy concatenate failed:", error);
      return NextResponse.json(
        { success: false, error: "Failed to concatenate videos" },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error("Concatenate error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to concatenate videos" },
      { status: 500 },
    );
  }
}
