import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/project-auth";
import { generatedStoreDir, generatedFilePath, resolvePublicAssetPath } from "@/lib/generated-store";
import { generateSceneNarration, DEFAULT_TTS_VOICE } from "@/lib/narration";
import { getAudioPath, audioFileExists } from "@/lib/audio-storage";
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

// ─── Scene Audio (narration + music) ───────────────────────────────────────────

/** The scene fields needed for audio collection. */
interface AudioScene {
  id: string;
  dialogue?: string | null;
  narrationUrl?: string | null;
  narrationVoice?: string | null;
  characterIds?: string | null;
  musicTrackUrl?: string | null;
  musicVolume?: number | null;
}

interface SceneAudioInfo {
  narrationPath: string | null;
  narrationGenerated: boolean; // true when TTS ran during this export
  musicPath: string | null;
  musicVolume: number; // 0..1 linear
}

export interface ExportAudioSummary {
  included: boolean;
  voices: number;             // scenes with narration audio in the mix
  voicesGenerated: number;    // voices auto-generated during this export
  voiceFailures: number;      // scenes whose TTS failed (skipped, non-fatal)
  musicScenes: number;        // scenes with music in the mix
}

/** Resolve an existing narration file from its /api/audio/<file> URL. */
function existingNarrationPath(narrationUrl: string): string | null {
  try {
    const filename = narrationUrl.split("?")[0].split("/").pop();
    if (!filename || filename.includes("..")) return null;
    if (audioFileExists(filename)) return getAudioPath(filename);
  } catch { /* ignore */ }
  return null;
}

/** Pick the best TTS voice for a scene: explicit → linked character → default. */
async function pickNarrationVoice(scene: AudioScene): Promise<string> {
  if (scene.narrationVoice) return scene.narrationVoice;
  try {
    const ids: unknown = JSON.parse(scene.characterIds || "[]");
    if (Array.isArray(ids) && ids.length > 0) {
      const chars = await db.character.findMany({
        where: { id: { in: ids.filter((i): i is string => typeof i === "string") } },
      });
      const withVoice = chars.find((c) => c.voiceId);
      if (withVoice?.voiceId) return withVoice.voiceId;
    }
  } catch { /* ignore bad JSON */ }
  return DEFAULT_TTS_VOICE;
}

/**
 * Collect (and if missing, auto-generate) narration audio for each scene,
 * plus per-scene background music. TTS failures are non-fatal — the scene
 * just exports without a voice so one flaky TTS call can't kill the export.
 */
async function collectSceneAudio(
  scenes: AudioScene[],
  includeAudio: boolean
): Promise<{ audio: SceneAudioInfo[]; summary: ExportAudioSummary }> {
  const audio: SceneAudioInfo[] = scenes.map(() => ({
    narrationPath: null,
    narrationGenerated: false,
    musicPath: null,
    musicVolume: 0,
  }));
  const summary: ExportAudioSummary = {
    included: includeAudio,
    voices: 0,
    voicesGenerated: 0,
    voiceFailures: 0,
    musicScenes: 0,
  };
  if (!includeAudio) return { audio, summary };

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];

    // ── Narration: reuse existing file, else auto-generate from dialogue ──
    let narrationPath: string | null = null;
    if (scene.narrationUrl) {
      narrationPath = existingNarrationPath(scene.narrationUrl);
    }

    if (!narrationPath && scene.dialogue && scene.dialogue.trim().length > 0) {
      const voice = await pickNarrationVoice(scene);
      try {
        console.log(`[Export] Auto-generating voice for scene ${scene.id} (voice=${voice})…`);
        const result = await generateSceneNarration({
          sceneId: scene.id,
          text: scene.dialogue,
          voice,
        });
        narrationPath = result.path;
        audio[i].narrationGenerated = true;
        summary.voicesGenerated++;
        // Persist so the studio player & future exports reuse it
        await db.videoScene
          .update({ where: { id: scene.id }, data: { narrationUrl: result.url, narrationVoice: voice } })
          .catch(() => { /* non-fatal */ });
      } catch (ttsErr) {
        summary.voiceFailures++;
        console.error(`[Export] TTS failed for scene ${scene.id} — exporting without its voice:`, ttsErr);
      }
    }

    if (narrationPath) {
      audio[i].narrationPath = narrationPath;
      summary.voices++;
    }

    // ── Music: resolve the per-scene track from public/ or the generated store ──
    if (scene.musicTrackUrl) {
      const musicPath = resolvePublicAssetPath(scene.musicTrackUrl);
      if (existsSync(musicPath)) {
        audio[i].musicPath = musicPath;
        // 0-100 slider → linear volume; keep it comfortably under narration
        audio[i].musicVolume = Math.min(1, Math.max(0, (scene.musicVolume ?? 30) / 100)) * 0.9;
        if (audio[i].musicVolume < 0.02) {
          audio[i].musicPath = null; // effectively muted — skip the input
        } else {
          summary.musicScenes++;
        }
      }
    }
  }

  return { audio, summary };
}

// ─── Timeline math ─────────────────────────────────────────────────────────────

/**
 * Start time of each video input on the final timeline.
 * Matches buildTransitionFilter's xfade offsets: input i fades in at
 *   start_i = sum(d0..d_{i-1}) − i·td   (xfade)   |   sum(d0..d_{i-1})   (cut)
 */
function sceneStartTimes(durations: number[], td: number, isCut: boolean): number[] {
  const starts: number[] = [];
  let cum = 0;
  for (let i = 0; i < durations.length; i++) {
    starts.push(i === 0 ? 0 : isCut ? cum : Math.max(0, cum - i * td));
    cum += durations[i];
  }
  return starts;
}

/** Exclusive on-screen span of video input i (last input keeps its full length). */
function sceneSpan(durations: number[], i: number, td: number): number {
  const isLast = i === durations.length - 1;
  return Math.max(0.5, isLast ? durations[i] : durations[i] - td);
}

// ─── Audio filter graph ────────────────────────────────────────────────────────

interface AudioLayerSpec {
  inputIndex: number; // absolute ffmpeg input index (after all video inputs)
  volume: number;
  startMs: number;
  trimTo?: number; // seconds — trim audio to the scene's on-screen span
  fadeOut: boolean;
}

/**
 * Build the audio mixing graph: each layer is normalized, optionally trimmed
 * (with a fade-out), delayed to its scene's timeline position, then all
 * layers are summed via amix.
 */
function buildAudioFilter(layers: AudioLayerSpec[]): string {
  const parts: string[] = [];
  const labels: string[] = [];

  layers.forEach((l, idx) => {
    const label = `a${idx}`;
    const chain: string[] = [
      "aresample=44100",
      "aformat=sample_fmts=fltp:channel_layouts=stereo",
      `volume=${l.volume.toFixed(3)}`,
    ];
    if (l.trimTo) {
      chain.push(`atrim=duration=${l.trimTo.toFixed(3)}`, "asetpts=PTS-STARTPTS");
      if (l.fadeOut) {
        const st = Math.max(0, l.trimTo - 0.6);
        chain.push(`afade=t=out:st=${st.toFixed(2)}:d=0.6`);
      }
    }
    if (l.startMs > 0) chain.push(`adelay=${Math.round(l.startMs)}:all=1`);
    parts.push(`[${l.inputIndex}:a]${chain.join(",")}[${label}]`);
    labels.push(`[${label}]`);
  });

  const mix = `${labels.join("")}amix=inputs=${layers.length}:duration=longest:normalize=0[aout]`;
  return [...parts, mix].join(";");
}

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
 * Build xfade/concat filter_complex string given per-scene durations.
 * Every input is first normalized (scale/pad/fps/format) to the target size so
 * clips with different resolutions or frame rates still merge cleanly.
 * For "cut" (duration=0) we use a simple concat filter instead.
 */
function buildTransitionFilter(
  durations: number[],
  transition: TransitionDef,
  targetSize: { w: number; h: number }
): string {
  const n = durations.length;

  // Single input — no filter needed
  if (n === 1) return "";

  const normalize = durations.map((_, i) => normalizeInputFilter(i, targetSize));

  // Hard cut — concat the normalized inputs (no overlap)
  if (transition.duration === 0) {
    const inputs = durations.map((_, i) => `[n${i}]`).join("");
    return [...normalize, `${inputs}concat=n=${n}:v=1:a=0[outv]`].join(";");
  }

  // xfade chain: [n0][n1]xfade=...:offset=T01[v01]; [v01][n2]xfade=...:offset=T12[v012]; ...
  const td = transition.duration;
  const parts: string[] = [...normalize];
  let prevLabel = "n0";
  let cumulativeOffset = durations[0] - td; // first offset = scene 0 length minus overlap

  for (let i = 1; i < n; i++) {
    const isLast = i === n - 1;
    const nextLabel = isLast ? "outv" : `v${i}`;
    const offset = Math.max(0, cumulativeOffset);

    parts.push(
      `[${prevLabel}][n${i}]xfade=transition=${transition.ffmpegName}:duration=${td}:offset=${offset.toFixed(3)}[${nextLabel}]`
    );

    prevLabel = nextLabel;
    cumulativeOffset += durations[i] - td;
  }

  return parts.join(";");
}

/**
 * Probe video dimensions with ffprobe.
 */
async function getVideoSize(filePath: string): Promise<{ w: number; h: number }> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", filePath],
      { timeout: 15000 }
    );
    const [w, h] = stdout.trim().split(",").map((n) => parseInt(n, 10));
    if (w > 0 && h > 0) return { w, h };
  } catch { /* fall through */ }
  return { w: 1920, h: 1080 };
}

/** Escape a filesystem path for use inside an ffmpeg filter option value. */
function escapeFilterPath(p: string): string {
  return p.replace(/([:'\\])/g, "\\$1");
}

/**
 * Build the per-input normalization chain so every clip shares size/fps/SAR —
 * xfade and concat REQUIRE uniform inputs, and scene clips can legitimately
 * differ (different engines, portrait/landscape substitutions, legacy files).
 */
function normalizeInputFilter(i: number, size: { w: number; h: number }): string {
  return (
    `[${i}:v]scale=${size.w}:${size.h}:force_original_aspect_ratio=decrease,` +
    `pad=${size.w}:${size.h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p[n${i}]`
  );
}

/**
 * Generate a title-card video (black background + project title) using ffmpeg.
 * Draws the title from a text file (no filter-escaping pitfalls) at the target
 * resolution so it crossfades cleanly with the first scene.
 * Returns the path to the generated title card file.
 */
async function generateTitleCard(
  workDir: string,
  projectTitle: string,
  size: { w: number; h: number }
): Promise<string | null> {
  const titleCardPath = path.join(workDir, "titlecard.mp4");
  const titleFile = path.join(workDir, "title.txt");
  const titleDuration = 3;

  try {
    await writeFile(titleFile, projectTitle.slice(0, 120), "utf8");
    const fontSize = Math.max(28, Math.round(Math.min(size.w, size.h) / 15));
    const subFontSize = Math.max(16, Math.round(fontSize / 2.5));
    const args = [
      "-y",
      "-f", "lavfi", "-i", `color=c=black:s=${size.w}x${size.h}:d=${titleDuration}:r=24`,
      "-vf",
      `drawtext=textfile=${escapeFilterPath(titleFile)}:expansion=none:fontcolor=white:fontsize=${fontSize}:x=(w-text_w)/2:y=(h-text_h)/2-20,` +
      `drawtext=text='Vidora AI':fontcolor=gray:fontsize=${subFontSize}:x=(w-text_w)/2:y=(h-text_h)/2+${Math.round(fontSize / 1.4)}:enable='between(t,0.3,2.7)'`,
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-t", String(titleDuration),
      titleCardPath,
    ];
    await execFileAsync("ffmpeg", args, { timeout: 30000 });
    return existsSync(titleCardPath) ? titleCardPath : null;
  } catch (err) {
    console.error("[Export] Title card generation failed:", err);
    return null;
  }
}

/**
 * Build a complete ffmpeg command string (video graph + optional audio mix).
 */
function buildFfmpegCommand(opts: {
  inputPaths: string[];
  audioPaths: string[];
  transitionFilter: string;
  audioFilter: string | null;
  quality: QualityPreset;
  format: string;
  outputPath: string;
}): string {
  const { inputPaths, audioPaths, transitionFilter, audioFilter, quality, format, outputPath } = opts;

  const videoInputs = inputPaths.map((p) => `-i "${p}"`).join(" ");
  const audioInputs = audioPaths.length > 0 ? audioPaths.map((p) => `-i "${p}"`).join(" ") : "";

  // Video filter chain: transition → format → optional scale
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

  const graphParts = [filterComplex, outputVf, audioFilter || ""].filter(Boolean);
  filterComplex = graphParts.join(";");

  const hasAudio = audioFilter !== null;

  const inputs = [videoInputs, audioInputs].filter(Boolean).join(" ");

  if (format === "webm") {
    const cpuUsed =
      quality.preset === "ultrafast" ? 8
        : quality.preset === "veryslow" ? 1
          : quality.preset === "slow" ? 2
            : quality.preset === "medium" ? 4
              : 6;

    return [
      `ffmpeg -y`,
      inputs,
      `-filter_complex "${filterComplex}"`,
      `-map "[final]"`,
      hasAudio ? `-map "[aout]" -c:a libopus -b:a 128k` : `-an`,
      `-c:v libvpx -crf ${quality.crf} -b:v 0 -cpu-used ${cpuUsed}`,
      `"${outputPath}"`,
    ].join(" ");
  }

  // Default: mp4 with libx264 + AAC audio
  return [
    `ffmpeg -y`,
    inputs,
    `-filter_complex "${filterComplex}"`,
    `-map "[final]"`,
    hasAudio ? `-map "[aout]" -c:a aac -b:a 192k` : `-an`,
    `-c:v libx264 -preset ${quality.preset} -crf ${quality.crf} -pix_fmt yuv420p -movflags +faststart`,
    `"${outputPath}"`,
  ].join(" ");
}

/**
 * Assemble the audio inputs / layers / filter for the export.
 *
 * @param durations   per video input durations (title card first, if present)
 * @param videoInputCount number of video inputs (durations.length)
 * @param sceneAudio  per-completed-scene audio info (aligned with scenes)
 * @param td          transition duration (0 for cut)
 * @param isCut       whether the transition is a hard cut
 * @returns audioPaths, audioFilter (null when no audio), plus per-layer debug info
 */
function assembleAudioGraph(
  durations: number[],
  sceneAudio: SceneAudioInfo[],
  td: number,
  isCut: boolean
): { audioPaths: string[]; audioFilter: string | null } {
  // Video input count (title card included in durations)
  const V = durations.length;
  const starts = sceneStartTimes(durations, td, isCut);

  // sceneAudio[i] belongs to completed scene i, whose video input index is:
  //   (V - sceneAudio.length + i)  — scenes come AFTER the optional title card
  const sceneOffset = V - sceneAudio.length;

  const audioPaths: string[] = [];
  const layers: AudioLayerSpec[] = [];

  sceneAudio.forEach((a, i) => {
    const videoIdx = sceneOffset + i;
    // Narration: start when the scene is (mostly) on screen; a little after
    // the crossfade begins so voices align with the dominant picture.
    const narStart = starts[videoIdx] + (isCut || videoIdx === 0 ? 0 : Math.min(td / 2, 0.5));
    if (a.narrationPath) {
      layers.push({
        inputIndex: V + audioPaths.length,
        volume: 1.0,
        startMs: Math.round(narStart * 1000),
        fadeOut: false,
      });
      audioPaths.push(a.narrationPath);
    }

    // Music: spans the scene's on-screen window, trimmed + faded out
    if (a.musicPath) {
      const span = sceneSpan(durations, videoIdx, td);
      layers.push({
        inputIndex: V + audioPaths.length,
        volume: a.musicVolume,
        startMs: Math.round(starts[videoIdx] * 1000),
        trimTo: span,
        fadeOut: true,
      });
      audioPaths.push(a.musicPath);
    }
  });

  if (layers.length === 0) return { audioPaths: [], audioFilter: null };

  console.log(
    `[Export] Audio mix: ${audioPaths.length} layer(s) — ` +
    layers.map((l) => `input#${l.inputIndex} vol=${l.volume.toFixed(2)} start=${(l.startMs / 1000).toFixed(2)}s${l.trimTo ? ` trim=${l.trimTo.toFixed(2)}s` : ""}`).join(" | ")
  );

  return { audioPaths, audioFilter: buildAudioFilter(layers) };
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
      includeAudio = true,
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
        withTitleCard,
        includeAudio
      );
    }

    // ── Multi-scene export ───────────────────────────────────────────────
    return await handleMultiSceneExport(
      project,
      completedScenes,
      qualityPreset,
      transitionDef,
      format,
      withTitleCard,
      includeAudio
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
  scene: { id: string; videoUrl: string | null; duration: number } & AudioScene,
  qualityPreset: QualityPreset,
  transitionDef: TransitionDef,
  format: string,
  withTitleCard: boolean,
  includeAudio: boolean
) {
  const projectId = project.id;

  await db.videoProject.update({
    where: { id: projectId },
    data: { status: "generating" },
  });

  const workDir = path.join(generatedStoreDir(), `export_${projectId}`);
  await mkdir(workDir, { recursive: true });

  try {
    const localPath = path.join(workDir, "scene_001.mp4");
    // Local-first for app-relative URLs (/generated/...): node fetch can't
    // fetch a relative path, so probe the file store directly instead of
    // burning 3 retry cycles on unparseable URLs.
    let sceneVideoPath = localPath;
    if (scene.videoUrl!.startsWith("/")) {
      const storeFile = resolvePublicAssetPath(scene.videoUrl!);
      if (existsSync(storeFile)) {
        sceneVideoPath = storeFile;
        console.log("[Export] Using local file for scene 1");
      }
    }
    if (sceneVideoPath === localPath) {
      await downloadWithRetry(scene.videoUrl!, localPath);
    }

    const ext = format === "webm" ? "webm" : "mp4";
    const timestamp = Date.now();
    const outputFileName = `final_${projectId}_${timestamp}.${ext}`;
    const outputPath = path.join(workDir, outputFileName);

    // For single scene, xfade is not applicable — use simple re-encode
    // Optionally prepend a title card via concat filter
    let inputPaths = [sceneVideoPath];
    let allDurations: number[] = [];

    // Title card is rendered at the scene's own resolution; the transition
    // graph normalizes both to that size.
    const targetSize = await getVideoSize(sceneVideoPath);

    if (withTitleCard && project.title) {
      const titleCardPath = await generateTitleCard(workDir, project.title, targetSize);
      if (titleCardPath) {
        const titleDur = await getVideoDuration(titleCardPath);
        const sceneDur = await getVideoDuration(sceneVideoPath);
        allDurations = [titleDur, sceneDur];
        inputPaths = [titleCardPath, sceneVideoPath];
      }
    }
    if (allDurations.length === 0) {
      allDurations = [await getVideoDuration(sceneVideoPath)];
    }

    // ── Audio: narration + music for the single scene ──
    const { audio: sceneAudio, summary } = await collectSceneAudio([scene], includeAudio);
    const td = inputPaths.length > 1 ? transitionDef.duration : 0;
    const isCut = td === 0;
    const { audioPaths, audioFilter } = assembleAudioGraph(allDurations, sceneAudio, td, isCut);

    let transitionFilter = "";
    if (inputPaths.length > 1) {
      transitionFilter = buildTransitionFilter(allDurations, transitionDef, targetSize);
    }

    const cmd = buildFfmpegCommand({
      inputPaths,
      audioPaths,
      transitionFilter,
      audioFilter,
      quality: qualityPreset,
      format,
      outputPath,
    });

    console.log("[Export] Single scene. FFmpeg:", cmd.slice(0, 300));
    await execAsync(cmd, { timeout: 300000 });

    if (!existsSync(outputPath)) {
      throw new Error("ffmpeg produced no output file");
    }

    // Copy final to the persistent generated store
    const finalPath = generatedFilePath(outputFileName);
    const finalData = await readFile(outputPath);
    await mkdir(path.dirname(finalPath), { recursive: true });
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

    const audioNote = audioSummaryNote(summary);
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
      audio: summary,
      message: `Single scene exported with ${qualityPreset.label} quality${audioNote}`,
    });
  } catch (err) {
    console.error("[Export] Single-scene export failed:", err);
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
  completedScenes: ({ id: string; videoUrl: string | null; duration: number } & AudioScene)[],
  qualityPreset: QualityPreset,
  transitionDef: TransitionDef,
  format: string,
  withTitleCard: boolean,
  includeAudio: boolean
) {
  const projectId = project.id;

  await db.videoProject.update({
    where: { id: projectId },
    data: { status: "generating" },
  });

  const workDir = path.join(generatedStoreDir(), `export_${projectId}`);
  await mkdir(workDir, { recursive: true });

  try {
    // ── Step 1: Download all scene videos ─────────────────────────────────
    console.log(`[Export] Downloading ${completedScenes.length} scene videos...`);
    const localPaths: string[] = [];

    for (let i = 0; i < completedScenes.length; i++) {
      const scene = completedScenes[i];
      const paddedNum = String(i + 1).padStart(3, "0");
      const localPath = path.join(workDir, `scene_${paddedNum}.mp4`);

      // Local-first for app-relative URLs (/generated/...): node fetch can't
      // fetch a relative path, so probe the file store directly instead of
      // burning 3 retry cycles on unparseable URLs.
      const isRelativeUrl = scene.videoUrl!.startsWith("/");
      if (isRelativeUrl) {
        const storeFile = resolvePublicAssetPath(scene.videoUrl!);
        if (existsSync(storeFile)) {
          localPaths.push(storeFile);
          console.log(`[Export] Using local file for scene ${i + 1}`);
          continue;
        }
      }

      try {
        await downloadWithRetry(scene.videoUrl!, localPath);
        localPaths.push(localPath);
        console.log(`[Export] Downloaded scene ${i + 1}/${completedScenes.length}`);
      } catch (dlErr) {
        // Fallback: check for local file
        const localFile = resolvePublicAssetPath(scene.videoUrl!);
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

    // ── Step 3: Collect / auto-generate scene audio (voices + music) ─────
    const { audio: sceneAudio, summary } = await collectSceneAudio(completedScenes, includeAudio);

    // ── Step 4: Optionally generate title card ────────────────────────────
    const ext = format === "webm" ? "webm" : "mp4";
    const timestamp = Date.now();
    const outputFileName = `final_${projectId}_${timestamp}.${ext}`;
    const outputPath = path.join(workDir, outputFileName);

    let inputPaths = [...localPaths];
    let allDurations = [...durations];

    // All inputs are normalized to the first scene's resolution (see
    // buildTransitionFilter) — the title card is rendered at that size too.
    const targetSize = await getVideoSize(localPaths[0]);

    if (withTitleCard && project.title) {
      const titleCardPath = await generateTitleCard(workDir, project.title, targetSize);
      if (titleCardPath) {
        const titleDur = await getVideoDuration(titleCardPath);
        inputPaths = [titleCardPath, ...localPaths];
        allDurations = [titleDur, ...durations];
        console.log(`[Export] Title card added (${titleDur.toFixed(2)}s)`);
      }
    }

    // ── Step 5: Build transition + audio filters ─────────────────────────
    const transitionFilter = buildTransitionFilter(allDurations, transitionDef, targetSize);
    const td = transitionDef.duration;
    const isCut = td === 0;
    const { audioPaths, audioFilter } = assembleAudioGraph(allDurations, sceneAudio, td, isCut);

    // ── Step 6: Build & run ffmpeg ──────────────────────────────────────
    const ffmpegCmd = buildFfmpegCommand({
      inputPaths,
      audioPaths,
      transitionFilter,
      audioFilter,
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

    // ── Step 7: Copy to the persistent generated store ───────────────
    const finalPath = generatedFilePath(outputFileName);
    const finalData = await readFile(outputPath);
    await mkdir(path.dirname(finalPath), { recursive: true });
    await writeFile(finalPath, finalData);

    const finalVideoUrl = `/generated/${outputFileName}`;

    // ── Step 8: Gather output stats ──────────────────────────────────
    const fileSize = statSync(finalPath).size;
    const outputDuration = await getVideoDuration(outputPath);
    const durationStr = formatDuration(outputDuration);

    // ── Step 9: Update project ───────────────────────────────────────
    await db.videoProject.update({
      where: { id: projectId },
      data: { finalVideoUrl, status: "completed" },
    });

    // ── Step 10: Cleanup ───────────────────────────────────────────────
    try {
      await rm(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }

    // ── Step 11: Return success ──────────────────────────────────────
    const audioNote = audioSummaryNote(summary);
    return NextResponse.json({
      success: true,
      finalVideoUrl,
      sceneCount: completedScenes.length,
      fileSize,
      duration: durationStr,
      quality: qualityPreset.label,
      transition: transitionDef.label,
      format,
      withTitleCard,
      audio: summary,
      message: `Video exported successfully! (${completedScenes.length} scenes, ${durationStr}, ${qualityPreset.label}, ${transitionDef.label}${audioNote})`,
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

/** Human note for the export toast about the audio mix. */
function audioSummaryNote(summary: ExportAudioSummary): string {
  if (!summary.included) return " (no audio)";
  const bits: string[] = [];
  if (summary.voices > 0) {
    bits.push(
      `${summary.voices} voiced scene${summary.voices > 1 ? "s" : ""}` +
      (summary.voicesGenerated > 0 ? ` (${summary.voicesGenerated} voice${summary.voicesGenerated > 1 ? "s" : ""} auto-generated)` : "")
    );
  }
  if (summary.musicScenes > 0) bits.push(`music on ${summary.musicScenes} scene${summary.musicScenes > 1 ? "s" : ""}`);
  if (summary.voiceFailures > 0) bits.push(`${summary.voiceFailures} voice generation failed — try re-exporting`);
  if (bits.length === 0) return " (no scene audio found)";
  return `; ${bits.join(", ")}`;
}
