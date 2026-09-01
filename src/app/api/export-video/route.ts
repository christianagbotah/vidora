import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/project-auth";
import { writeFile, mkdir, rm, readFile } from "fs/promises";
import { existsSync, statSync } from "fs";
import path from "path";
import { execFile, exec } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
// NOTE: execAsync is used for complex ffmpeg commands that require shell
// quoting (filter expressions with special chars). All paths are server-generated
// from UUIDs — no user-controlled path injection risk. The only user input in
// commands is the project title, which is escaped in generateTitleCard().
const execAsync = promisify(exec);

async function checkFfmpeg(): Promise<boolean> {
  try {
    await execFileAsync("which", ["ffmpeg"]);
    await execFileAsync("which", ["ffprobe"]);
    return true;
  } catch {
    return false;
  }
}

// ─── Quality Presets ───────────────────────────────────────────────────────────

interface QualityPreset {
  label: string;
  crf: number;
  preset: string;
  scale?: string;
}

const QUALITY_PRESETS: Record<string, QualityPreset> = {
  draft: {
    label: "720p Draft",
    crf: 28,
    preset: "ultrafast",
    scale: "scale=-2:720",
  },
  standard: {
    label: "1080p Standard",
    crf: 23,
    preset: "medium",
  },
  high: {
    label: "1080p High Quality",
    crf: 18,
    preset: "slow",
  },
  ultra: {
    label: "4K Ultra",
    crf: 15,
    preset: "veryslow",
    scale: "scale=-2:2160",
  },
};

// ─── Transition Definitions ────────────────────────────────────────────────────

interface TransitionDef {
  ffmpegName: string;
  duration: number;
  label: string;
}

const TRANSITIONS: Record<string, TransitionDef> = {
  fade:     { ffmpegName: "fade",     duration: 1.0, label: "Crossfade (1s)" },
  dissolve: { ffmpegName: "dissolve", duration: 1.5, label: "Dissolve (1.5s)" },
  wipe:     { ffmpegName: "wipeleft", duration: 1.0, label: "Horizontal Wipe" },
  slide:    { ffmpegName: "slideleft",duration: 1.0, label: "Slide Left" },
  cut:      { ffmpegName: "fadeblack",duration: 0,   label: "Hard Cut" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Download a file with rate-limit retry and exponential backoff.
 */
async function downloadWithRetry(
  url: string,
  destPath: string,
  maxRetries = 3,
  baseDelayMs = 2000
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url);

      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        const delay = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : baseDelayMs * Math.pow(2, attempt - 1);
        console.warn(
          `[Export] Rate limited on ${url}, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`
        );
        await sleep(delay);
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(destPath, buffer);
      return;
    } catch (err) {
      const isLast = attempt === maxRetries;
      console.error(
        `[Export] Download attempt ${attempt}/${maxRetries} failed for ${url}:`,
        err
      );
      if (isLast) throw err;
      const jitter = Math.random() * 1000;
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + jitter;
      await sleep(delay);
    }
  }
}

/**
 * Probe video duration with ffprobe.
 */
async function getVideoDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
      { timeout: 15000 }
    );
    return parseFloat(stdout.trim()) || 10;
  } catch {
    return 10;
  }
}

/**
 * Build xfade filter_complex string given per-scene durations.
 * For "cut" (duration=0) we use a simple concat filter instead.
 */
function buildTransitionFilter(
  durations: number[],
  transition: TransitionDef
): string {
  const n = durations.length;

  // Single input — no filter needed
  if (n === 1) return "";

  // Hard cut — use concat demuxer-style concat filter (no overlap)
  if (transition.duration === 0) {
    const inputs = durations.map((_, i) => `[${i}:v]`).join("");
    return `${inputs}concat=n=${n}:v=1:a=0[outv]`;
  }

  // xfade chain: [0:v][1:v]xfade=...:offset=T01[v01]; [v01][2:v]xfade=...:offset=T12[v012]; ...
  const td = transition.duration;
  const parts: string[] = [];
  let prevLabel = "0:v";
  let cumulativeOffset = durations[0] - td; // first offset = scene 0 length minus overlap

  for (let i = 1; i < n; i++) {
    const isLast = i === n - 1;
    const nextLabel = isLast ? "outv" : `v${i}`;
    const offset = Math.max(0, cumulativeOffset);

    parts.push(
      `[${prevLabel}][${i}:v]xfade=transition=${transition.ffmpegName}:duration=${td}:offset=${offset.toFixed(3)}[${nextLabel}]`
    );

    prevLabel = nextLabel;
    cumulativeOffset += durations[i] - td;
  }

  return parts.join(";");
}

/**
 * Generate a title-card video (black background + project title) using ffmpeg.
 * Returns the path to the generated title card file.
 */
async function generateTitleCard(
  workDir: string,
  projectTitle: string
): Promise<string | null> {
  const titleCardPath = path.join(workDir, "titlecard.mp4");
  const titleDuration = 3;

  // Escape characters that are special in ffmpeg drawtext
  const escapedTitle = projectTitle
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "'\\''")
    .replace(/:/g, "\\:")
    .replace(/%/g, "%%");

  const cmd = [
    `ffmpeg -y`,
    `-f lavfi -i "color=c=black:s=1920x1080:d=${titleDuration}:r=24"`,
    `-vf`,
    `"drawtext=text='${escapedTitle}':fontcolor=white:fontsize=72:x=(w-text_w)/2:y=(h-text_h)/2-20,drawtext=text='Vidora AI':fontcolor=gray:fontsize=28:x=(w-text_w)/2:y=(h-text_h)/2+60:enable='between(t,0.3,2.7)'"`,
    `-c:v libx264 -preset ultrafast -pix_fmt yuv420p -t ${titleDuration}`,
    `"${titleCardPath}"`,
  ].join(" ");

  try {
    await execFileAsync("ffmpeg", cmd.split(" "), { timeout: 30000 });
    return existsSync(titleCardPath) ? titleCardPath : null;
  } catch (err) {
    console.error("[Export] Title card generation failed:", err);
    return null;
  }
}

/**
 * Build a complete ffmpeg command string.
 */
function buildFfmpegCommand(opts: {
  inputPaths: string[];
  transitionFilter: string;
  quality: QualityPreset;
  format: string;
  outputPath: string;
}): string {
  const { inputPaths, transitionFilter, quality, format, outputPath } = opts;

  const inputArgs = inputPaths.map((p) => `-i "${p}"`).join(" ");

  // Video filter chain: transition → format → optional scale
  const vfParts: string[] = [];

  // Apply transition filter
  if (transitionFilter) {
    vfParts.push(transitionFilter);
  }

  // Output stream label
  const streamLabel = inputPaths.length === 1 ? "0:v" : "outv";

  // Build the filter_complex: transition filter(s) + output stream preparation
  let filterComplex = "";
  if (transitionFilter) {
    filterComplex = transitionFilter;
  }

  // Append output scaling and pixel format on the final stream
  const scalePart = quality.scale || "";
  const outputFilter = `format=yuv420p${scalePart ? `,${scalePart}` : ""}`;
  const outputVf = `[${streamLabel}]${outputFilter}[final]`;

  if (filterComplex) {
    filterComplex = `${filterComplex};${outputVf}`;
  } else {
    filterComplex = outputVf;
  }

  if (format === "webm") {
    const cpuUsed =
      quality.preset === "ultrafast" ? 8
        : quality.preset === "veryslow" ? 1
          : quality.preset === "slow" ? 2
            : quality.preset === "medium" ? 4
              : 6;

    return [
      `ffmpeg -y`,
      inputArgs,
      `-filter_complex "${filterComplex}"`,
      `-map "[final]"`,
      `-c:v libvpx -crf ${quality.crf} -b:v 0 -cpu-used ${cpuUsed}`,
      `-an`,
      `"${outputPath}"`,
    ].join(" ");
  }

  // Default: mp4 with libx264
  return [
    `ffmpeg -y`,
    inputArgs,
    `-filter_complex "${filterComplex}"`,
    `-map "[final]"`,
    `-c:v libx264 -preset ${quality.preset} -crf ${quality.crf} -pix_fmt yuv420p -movflags +faststart`,
    `"${outputPath}"`,
  ].join(" ");
}

// ─── Main POST Handler ────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // ── Auth check ─────────────────────────────────────────────────────
    const body = await req.json();
    const { projectId } = body;
    if (!projectId) {
      return NextResponse.json({ success: false, error: "Project ID is required" }, { status: 400 });
    }
    const authResult = await requireProjectAccess(projectId, true);
    if (!authResult.ok) return authResult.response;

    // ── Validate ffmpeg is available ──────────────────────────────────────
    const hasFfmpeg = await checkFfmpeg();
    if (!hasFfmpeg) {
      return NextResponse.json(
        { success: false, error: "ffmpeg/ffprobe is not installed on the server. Please install them (e.g. sudo apt install ffmpeg) to export videos." },
        { status: 500 }
      );
    }

    // ── Parse & validate request body ──────────────────────────────────────
    const {
      quality = "standard",
      transition = "fade",
      format = "mp4",
      withTitleCard = false,
    } = body;

    const qualityPreset = QUALITY_PRESETS[quality];
    if (!qualityPreset) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid quality: "${quality}". Must be one of: ${Object.keys(QUALITY_PRESETS).join(", ")}`,
        },
        { status: 400 }
      );
    }

    const transitionDef = TRANSITIONS[transition];
    if (!transitionDef) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid transition: "${transition}". Must be one of: ${Object.keys(TRANSITIONS).join(", ")}`,
        },
        { status: 400 }
      );
    }

    if (!["mp4", "webm"].includes(format)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid format: "${format}". Must be mp4 or webm`,
        },
        { status: 400 }
      );
    }

    // ── Fetch project ─────────────────────────────────────────────────────
    const project = await db.videoProject.findUnique({
      where: { id: projectId },
      include: { scenes: { orderBy: { sceneNumber: "asc" } } },
    });

    if (!project) {
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 }
      );
    }

    const completedScenes = project.scenes.filter((s) => s.videoUrl);
    if (completedScenes.length === 0) {
      return NextResponse.json(
        { success: false, error: "No completed video scenes to export" },
        { status: 400 }
      );
    }

    // ── Single-scene shortcut ────────────────────────────────────────────
    if (completedScenes.length === 1) {
      return await handleSingleSceneExport(
        project,
        completedScenes[0],
        qualityPreset,
        transitionDef,
        format,
        withTitleCard
      );
    }

    // ── Multi-scene export ───────────────────────────────────────────────
    return await handleMultiSceneExport(
      project,
      completedScenes,
      qualityPreset,
      transitionDef,
      format,
      withTitleCard
    );
  } catch (error) {
    console.error("[Export] Unhandled error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to export video" },
      { status: 500 }
    );
  }
}

// ─── Single-Scene Export ────────────────────────────────────────────────────────

async function handleSingleSceneExport(
  project: { id: string; title: string },
  scene: { videoUrl: string | null; duration: number },
  qualityPreset: QualityPreset,
  transitionDef: TransitionDef,
  format: string,
  withTitleCard: boolean
) {
  const projectId = project.id;

  await db.videoProject.update({
    where: { id: projectId },
    data: { status: "generating" },
  });

  const workDir = path.join(process.cwd(), "public", "generated", `export_${projectId}`);
  await mkdir(workDir, { recursive: true });

  try {
    const localPath = path.join(workDir, "scene_001.mp4");
    await downloadWithRetry(scene.videoUrl!, localPath);

    const ext = format === "webm" ? "webm" : "mp4";
    const timestamp = Date.now();
    const outputFileName = `final_${projectId}_${timestamp}.${ext}`;
    const outputPath = path.join(workDir, outputFileName);

    // For single scene, xfade is not applicable — use simple re-encode
    // Optionally prepend a title card via concat filter
    let inputPaths = [localPath];

    if (withTitleCard && project.title) {
      const titleCardPath = await generateTitleCard(workDir, project.title);
      if (titleCardPath) {
        const titleDur = await getVideoDuration(titleCardPath);
        const sceneDur = await getVideoDuration(localPath);
        const allDurations = [titleDur, sceneDur];
        const transitionFilter = buildTransitionFilter(allDurations, transitionDef);
        inputPaths = [titleCardPath, localPath];

        const cmd = buildFfmpegCommand({
          inputPaths,
          transitionFilter,
          quality: qualityPreset,
          format,
          outputPath,
        });

        console.log("[Export] Single scene + title card. FFmpeg:", cmd.slice(0, 300));
        await execAsync(cmd, { timeout: 300000 });
      } else {
        // Title card failed — export scene alone
        const cmd = buildFfmpegCommand({
          inputPaths,
          transitionFilter: "",
          quality: qualityPreset,
          format,
          outputPath,
        });
        await execAsync(cmd, { timeout: 300000 });
      }
    } else {
      const cmd = buildFfmpegCommand({
        inputPaths,
        transitionFilter: "",
        quality: qualityPreset,
        format,
        outputPath,
      });
      await execAsync(cmd, { timeout: 300000 });
    }

    if (!existsSync(outputPath)) {
      throw new Error("ffmpeg produced no output file");
    }

    // Copy final to public
    const finalPath = path.join(process.cwd(), "public", "generated", outputFileName);
    const finalData = await readFile(outputPath);
    await writeFile(finalPath, finalData);

    const finalVideoUrl = `/generated/${outputFileName}`;
    const fileSize = statSync(finalPath).size;
    const outputDuration = await getVideoDuration(outputPath);
    const durationStr = formatDuration(outputDuration);

    await db.videoProject.update({
      where: { id: projectId },
      data: { finalVideoUrl, status: "completed" },
    });

    try { await rm(workDir, { recursive: true, force: true }); } catch { /* ignore */ }

    return NextResponse.json({
      success: true,
      finalVideoUrl,
      sceneCount: 1,
      fileSize,
      duration: durationStr,
      quality: qualityPreset.label,
      transition: transitionDef.label,
      format,
      withTitleCard,
      message: `Single scene exported with ${qualityPreset.label} quality`,
    });
  } catch (err) {
    try { await rm(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
    await db.videoProject.update({ where: { id: projectId }, data: { status: "failed" } });
    return NextResponse.json(
      { success: false, error: "Failed to export video" },
      { status: 500 }
    );
  }
}

// ─── Multi-Scene Export ─────────────────────────────────────────────────────────

async function handleMultiSceneExport(
  project: { id: string; title: string },
  completedScenes: { videoUrl: string | null; duration: number }[],
  qualityPreset: QualityPreset,
  transitionDef: TransitionDef,
  format: string,
  withTitleCard: boolean
) {
  const projectId = project.id;

  await db.videoProject.update({
    where: { id: projectId },
    data: { status: "generating" },
  });

  const workDir = path.join(process.cwd(), "public", "generated", `export_${projectId}`);
  await mkdir(workDir, { recursive: true });

  try {
    // ── Step 1: Download all scene videos ─────────────────────────────────
    console.log(`[Export] Downloading ${completedScenes.length} scene videos...`);
    const localPaths: string[] = [];

    for (let i = 0; i < completedScenes.length; i++) {
      const scene = completedScenes[i];
      const paddedNum = String(i + 1).padStart(3, "0");
      const localPath = path.join(workDir, `scene_${paddedNum}.mp4`);

      try {
        await downloadWithRetry(scene.videoUrl!, localPath);
        localPaths.push(localPath);
        console.log(`[Export] Downloaded scene ${i + 1}/${completedScenes.length}`);
      } catch (dlErr) {
        // Fallback: check for local file
        const localFile = path.join(process.cwd(), scene.videoUrl!);
        if (existsSync(localFile)) {
          localPaths.push(localFile);
          console.log(`[Export] Using local file for scene ${i + 1}`);
        } else {
          console.error(`[Export] Failed to download scene ${i + 1}:`, dlErr);
          throw new Error(`Could not download scene ${i + 1} video after retries`);
        }
      }

      // Brief pause between downloads to reduce rate limiting
      if (i < completedScenes.length - 1) {
        await sleep(500);
      }
    }

    if (localPaths.length < 2) {
      throw new Error("Not enough video clips downloaded. Need at least 2 for multi-scene export.");
    }

    // ── Step 2: Probe durations ──────────────────────────────────────────
    console.log("[Export] Probing video durations...");
    const durations: number[] = [];
    for (let i = 0; i < localPaths.length; i++) {
      const dur = await getVideoDuration(localPaths[i]);
      durations.push(dur);
      console.log(`[Export] Scene ${i + 1} duration: ${dur.toFixed(2)}s`);
    }

    // ── Step 3: Optionally generate title card ────────────────────────────
    const ext = format === "webm" ? "webm" : "mp4";
    const timestamp = Date.now();
    const outputFileName = `final_${projectId}_${timestamp}.${ext}`;
    const outputPath = path.join(workDir, outputFileName);

    let inputPaths = [...localPaths];
    let allDurations = [...durations];

    if (withTitleCard && project.title) {
      const titleCardPath = await generateTitleCard(workDir, project.title);
      if (titleCardPath) {
        const titleDur = await getVideoDuration(titleCardPath);
        inputPaths = [titleCardPath, ...localPaths];
        allDurations = [titleDur, ...durations];
        console.log(`[Export] Title card added (${titleDur.toFixed(2)}s)`);
      }
    }

    // ── Step 4: Build transition filter ─────────────────────────────────
    const transitionFilter = buildTransitionFilter(allDurations, transitionDef);

    // ── Step 5: Build & run ffmpeg ──────────────────────────────────────
    const ffmpegCmd = buildFfmpegCommand({
      inputPaths,
      transitionFilter,
      quality: qualityPreset,
      format,
      outputPath,
    });

    console.log("[Export] Running ffmpeg command...");
    console.log("[Export] Command:", ffmpegCmd.slice(0, 500));
    await execAsync(ffmpegCmd, { timeout: 600000 });

    if (!existsSync(outputPath)) {
      throw new Error("ffmpeg export produced no output file");
    }

    // ── Step 6: Copy to public/generated ───────────────────────────────
    const finalPath = path.join(process.cwd(), "public", "generated", outputFileName);
    const finalData = await readFile(outputPath);
    await writeFile(finalPath, finalData);

    const finalVideoUrl = `/generated/${outputFileName}`;

    // ── Step 7: Gather output stats ──────────────────────────────────
    const fileSize = statSync(finalPath).size;
    const outputDuration = await getVideoDuration(outputPath);
    const durationStr = formatDuration(outputDuration);

    // ── Step 8: Update project ───────────────────────────────────────
    await db.videoProject.update({
      where: { id: projectId },
      data: { finalVideoUrl, status: "completed" },
    });

    // ── Step 9: Cleanup ───────────────────────────────────────────────
    try {
      await rm(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }

    // ── Step 10: Return success ──────────────────────────────────────
    return NextResponse.json({
      success: true,
      finalVideoUrl,
      sceneCount: completedScenes.length,
      fileSize,
      duration: durationStr,
      quality,
      qualityLabel: qualityPreset.label,
      transition,
      transitionLabel: transitionDef.label,
      format,
      withTitleCard,
      message: `Video exported successfully! (${completedScenes.length} scenes, ${durationStr}, ${qualityPreset.label}, ${transitionDef.label})`,
    });
  } catch (err) {
    try {
      await rm(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }

    console.error("[Export] Export failed:", err);

    await db.videoProject.update({
      where: { id: projectId },
      data: { status: "failed" },
    });

    return NextResponse.json(
      { success: false, error: "Failed to export video" },
      { status: 500 }
    );
  }
}

// ─── Utility ───────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const totalSec = Math.ceil(seconds);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}
