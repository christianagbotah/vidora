import { execFile, spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { promisify } from "util";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import os from "os";
import path from "path";
import type { PassThrough } from "stream";
import { db } from "@/lib/db";
import { audioFileExists, getAudioPath } from "@/lib/audio-storage";
import { resolvePublicAssetPath } from "@/lib/generated-store";
import { currentCutIsReviewed, mediaJobMode } from "@/lib/media-job-mode";
import { generateSceneNarration, pickSceneNarrationVoice } from "@/lib/narration";
import { resolveSceneLanguageText } from "@/lib/scene-language";
import { materializeSceneVideo } from "@/lib/scene-video-materializer";

const execFileAsync = promisify(execFile);
const AMBIENCE_VOLUME = 0.6;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

interface QualityPreset {
  label: string;
  crf: number;
  preset: string;
  scale?: string;
}

const QUALITY_PRESETS: Record<string, QualityPreset> = {
  draft: { label: "720p Draft", crf: 28, preset: "ultrafast", scale: "scale=-2:720" },
  standard: { label: "1080p Standard", crf: 23, preset: "medium" },
  high: { label: "1080p High Quality", crf: 18, preset: "slow" },
  ultra: { label: "4K Ultra", crf: 15, preset: "veryslow", scale: "scale=-2:2160" },
};

interface TransitionDef {
  ffmpegName: string;
  duration: number;
  label: string;
}

const TRANSITIONS: Record<string, TransitionDef> = {
  fade: { ffmpegName: "fade", duration: 1, label: "Crossfade (1s)" },
  dissolve: { ffmpegName: "dissolve", duration: 1.5, label: "Dissolve (1.5s)" },
  wipe: { ffmpegName: "wipeleft", duration: 1, label: "Horizontal Wipe" },
  slide: { ffmpegName: "slideleft", duration: 1, label: "Slide Left" },
  cut: { ffmpegName: "fadeblack", duration: 0, label: "Hard Cut" },
};

interface DirectExportParams {
  mode: "final";
  expectedCutVersion: number;
  quality: string;
  transition: string;
  format: "mp4" | "webm";
  withTitleCard: boolean;
  includeAudio: boolean;
}

interface ExportScene {
  id: string;
  sceneNumber: number;
  videoUrl: string | null;
  taskId: string | null;
  duration: number;
  dialogue: string | null;
  narrationUrl: string | null;
  narrationVoice: string | null;
  narrationLang: string | null;
  narrationAccent: string | null;
  narrationStyle: string | null;
  characterIds: string | null;
  musicTrackUrl: string | null;
  musicVolume: number;
}

interface SceneAudioInfo {
  narrationPath: string | null;
  musicPath: string | null;
  musicVolume: number;
}

interface ExportAudioSummary {
  included: boolean;
  voices: number;
  voicesGenerated: number;
  voiceFailures: number;
  musicScenes: number;
}

interface AudioLayerSpec {
  inputIndex: number;
  volume: number;
  startMs: number;
  trimTo?: number;
  fadeOut: boolean;
}

type ProgressFn = (pct: number, step: string) => Promise<void>;

function parseParams(raw: string | null): DirectExportParams {
  let value: Record<string, unknown> = {};
  if (raw) {
    try {
      value = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error("Export settings are corrupted");
    }
  }
  const quality = typeof value.quality === "string" ? value.quality : "standard";
  const transition = typeof value.transition === "string" ? value.transition : "fade";
  const format = value.format === "webm" ? "webm" : "mp4";
  const expectedCutVersion = Number(value.expectedCutVersion);
  if (!QUALITY_PRESETS[quality]) throw new Error("Unsupported export quality");
  if (!TRANSITIONS[transition]) throw new Error("Unsupported export transition");
  if (!Number.isSafeInteger(expectedCutVersion) || expectedCutVersion < 0) {
    throw new Error("Export cut version is missing");
  }
  return {
    mode: "final",
    expectedCutVersion,
    quality,
    transition,
    format,
    withTitleCard: value.withTitleCard === true,
    includeAudio: value.includeAudio !== false,
  };
}

export function directExportFormat(raw: string | null): "mp4" | "webm" {
  if (!raw) return "mp4";
  try {
    const value = JSON.parse(raw) as { format?: unknown };
    return value.format === "webm" ? "webm" : "mp4";
  } catch {
    return "mp4";
  }
}

export function directExportContentType(format: "mp4" | "webm"): string {
  return format === "webm" ? "video/webm" : "video/mp4";
}

export function directExportFilename(title: string, format: "mp4" | "webm"): string {
  const safe = title
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._ -]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || "vidora-video";
  return `${safe}.${format}`;
}

function expectedTimelineDuration(durations: number[], overlap: number): number {
  const sum = durations.reduce((total, duration) => total + duration, 0);
  return Math.max(1, sum - Math.max(0, durations.length - 1) * overlap);
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

async function getVideoDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
      { timeout: 15_000 },
    );
    return Number.parseFloat(stdout.trim()) || 10;
  } catch {
    return 10;
  }
}

async function getVideoSize(filePath: string): Promise<{ w: number; h: number }> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", filePath],
      { timeout: 15_000 },
    );
    const [w, h] = stdout.trim().split(",").map((value) => Number.parseInt(value, 10));
    if (w > 0 && h > 0) return { w, h };
  } catch {
    // Fall through to a safe landscape default.
  }
  return { w: 1920, h: 1080 };
}

async function hasAudioStream(filePath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", filePath],
      { timeout: 15_000 },
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

function escapeFilterPath(value: string): string {
  return value.replace(/([:'\\])/g, "\\$1");
}

async function generateTitleCard(
  workDir: string,
  title: string,
  size: { w: number; h: number },
): Promise<string | null> {
  const output = path.join(workDir, "titlecard.mp4");
  const titleFile = path.join(workDir, "title.txt");
  await writeFile(titleFile, title.slice(0, 120), "utf8");
  const fontSize = Math.max(28, Math.round(Math.min(size.w, size.h) / 15));
  const subFontSize = Math.max(16, Math.round(fontSize / 2.5));
  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-nostdin", "-y", "-f", "lavfi", "-i", `color=c=black:s=${size.w}x${size.h}:d=3:r=24`,
        "-vf",
        `drawtext=textfile=${escapeFilterPath(titleFile)}:expansion=none:fontcolor=white:fontsize=${fontSize}:x=(w-text_w)/2:y=(h-text_h)/2-20,` +
          `drawtext=text='Vidora Studio':fontcolor=gray:fontsize=${subFontSize}:x=(w-text_w)/2:y=(h-text_h)/2+${Math.round(fontSize / 1.4)}:enable='between(t,0.3,2.7)'`,
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-t", "3", output,
      ],
      { timeout: 30_000 },
    );
    return existsSync(output) ? output : null;
  } catch (error) {
    console.warn("[direct-export] title card skipped:", error instanceof Error ? error.message : "unknown error");
    return null;
  }
}

async function downloadLegacyScene(url: string, destination: string): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await writeFile(destination, Buffer.from(await response.arrayBuffer()));
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not fetch legacy scene media");
}

async function materializeScenes(
  scenes: ExportScene[],
  workDir: string,
  onProgress: ProgressFn,
): Promise<string[]> {
  const paths: string[] = [];
  for (let index = 0; index < scenes.length; index++) {
    const scene = scenes[index];
    await onProgress(5 + (20 * index) / Math.max(1, scenes.length), `Preparing scene ${index + 1} of ${scenes.length}…`);
    try {
      paths.push(await materializeSceneVideo(scene));
      continue;
    } catch (error) {
      if (!scene.videoUrl || scene.videoUrl.startsWith("/")) throw error;
    }
    const fallback = path.join(workDir, `scene_${String(index + 1).padStart(3, "0")}.mp4`);
    await downloadLegacyScene(scene.videoUrl!, fallback);
    paths.push(fallback);
  }
  return paths;
}

function existingNarrationPath(url: string): string | null {
  const filename = url.split("?")[0].split("/").pop();
  if (!filename || filename.includes("..")) return null;
  return audioFileExists(filename) ? getAudioPath(filename) : null;
}

async function collectSceneAudio(
  scenes: ExportScene[],
  includeAudio: boolean,
  onProgress: ProgressFn,
): Promise<{ audio: SceneAudioInfo[]; summary: ExportAudioSummary }> {
  const audio = scenes.map<SceneAudioInfo>(() => ({ narrationPath: null, musicPath: null, musicVolume: 0 }));
  const summary: ExportAudioSummary = {
    included: includeAudio,
    voices: 0,
    voicesGenerated: 0,
    voiceFailures: 0,
    musicScenes: 0,
  };
  if (!includeAudio) return { audio, summary };

  for (let index = 0; index < scenes.length; index++) {
    const scene = scenes[index];
    await onProgress(30 + (23 * index) / Math.max(1, scenes.length), `Preparing audio ${index + 1} of ${scenes.length}…`);
    let narrationPath = scene.narrationUrl ? existingNarrationPath(scene.narrationUrl) : null;

    if (!narrationPath && scene.dialogue?.trim()) {
      try {
        const voice = await pickSceneNarrationVoice(scene);
        const language = scene.narrationLang || "en";
        const narrationText = language === "en"
          ? scene.dialogue.trim()
          : (await resolveSceneLanguageText(scene.id, language)).text;
        const generated = await generateSceneNarration({
          sceneId: scene.id,
          text: narrationText,
          voice,
          language,
          accent: scene.narrationAccent || undefined,
          style: scene.narrationStyle || undefined,
        });
        narrationPath = generated.path;
        summary.voicesGenerated++;
        await db.videoScene.update({
          where: { id: scene.id },
          data: {
            narrationUrl: generated.url,
            narrationVoice: voice,
            narrationLang: generated.profile.language,
            narrationAccent: generated.profile.accent,
            narrationStyle: generated.profile.style,
          },
        }).catch(() => undefined);
      } catch (error) {
        summary.voiceFailures++;
        console.warn(`[direct-export] TTS skipped for scene ${scene.id}:`, error instanceof Error ? error.message : "unknown error");
      }
    }

    if (narrationPath) {
      audio[index].narrationPath = narrationPath;
      summary.voices++;
    }

    if (scene.musicTrackUrl) {
      const musicPath = resolvePublicAssetPath(scene.musicTrackUrl);
      if (existsSync(musicPath)) {
        const volume = Math.min(1, Math.max(0, (scene.musicVolume ?? 30) / 100)) * 0.9;
        if (volume >= 0.02) {
          audio[index].musicPath = musicPath;
          audio[index].musicVolume = volume;
          summary.musicScenes++;
        }
      }
    }
  }
  return { audio, summary };
}

function normalizeInputFilter(index: number, size: { w: number; h: number }): string {
  return `[${index}:v]scale=${size.w}:${size.h}:force_original_aspect_ratio=decrease,pad=${size.w}:${size.h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p[n${index}]`;
}

function buildTransitionFilter(
  durations: number[],
  transition: TransitionDef,
  size: { w: number; h: number },
): string {
  if (durations.length === 1) return "";
  const normalize = durations.map((_, index) => normalizeInputFilter(index, size));
  if (transition.duration === 0) {
    const labels = durations.map((_, index) => `[n${index}]`).join("");
    return [...normalize, `${labels}concat=n=${durations.length}:v=1:a=0[outv]`].join(";");
  }

  const parts = [...normalize];
  let previous = "n0";
  let offset = durations[0] - transition.duration;
  for (let index = 1; index < durations.length; index++) {
    const next = index === durations.length - 1 ? "outv" : `v${index}`;
    parts.push(
      `[${previous}][n${index}]xfade=transition=${transition.ffmpegName}:duration=${transition.duration}:offset=${Math.max(0, offset).toFixed(3)}[${next}]`,
    );
    previous = next;
    offset += durations[index] - transition.duration;
  }
  return parts.join(";");
}

function sceneStartTimes(durations: number[], overlap: number, isCut: boolean): number[] {
  let total = 0;
  return durations.map((duration, index) => {
    const start = index === 0 ? 0 : isCut ? total : Math.max(0, total - index * overlap);
    total += duration;
    return start;
  });
}

function sceneSpan(durations: number[], index: number, overlap: number): number {
  return Math.max(0.5, index === durations.length - 1 ? durations[index] : durations[index] - overlap);
}

function buildAudioFilter(layers: AudioLayerSpec[]): string {
  const parts: string[] = [];
  const labels: string[] = [];
  layers.forEach((layer, index) => {
    const label = `a${index}`;
    const chain = [
      "aresample=44100",
      "aformat=sample_fmts=fltp:channel_layouts=stereo",
      `volume=${layer.volume.toFixed(3)}`,
    ];
    if (layer.trimTo) {
      chain.push(`atrim=duration=${layer.trimTo.toFixed(3)}`, "asetpts=PTS-STARTPTS");
      if (layer.fadeOut) {
        chain.push(`afade=t=out:st=${Math.max(0, layer.trimTo - 0.6).toFixed(2)}:d=0.6`);
      }
    }
    if (layer.startMs > 0) chain.push(`adelay=${Math.round(layer.startMs)}:all=1`);
    parts.push(`[${layer.inputIndex}:a]${chain.join(",")}[${label}]`);
    labels.push(`[${label}]`);
  });
  parts.push(`${labels.join("")}amix=inputs=${layers.length}:duration=longest:normalize=0[aout]`);
  return parts.join(";");
}

function assembleAudioGraph(
  durations: number[],
  sceneAudio: SceneAudioInfo[],
  overlap: number,
  videoInputAudio: boolean[],
): { audioPaths: string[]; audioFilter: string | null } {
  const videoCount = durations.length;
  const sceneOffset = videoCount - sceneAudio.length;
  const starts = sceneStartTimes(durations, overlap, overlap === 0);
  const audioPaths: string[] = [];
  const layers: AudioLayerSpec[] = [];

  sceneAudio.forEach((entry, index) => {
    const videoIndex = sceneOffset + index;
    const narrationStart = starts[videoIndex] + (overlap === 0 || videoIndex === 0 ? 0 : Math.min(overlap / 2, 0.5));
    if (entry.narrationPath) {
      layers.push({
        inputIndex: videoCount + audioPaths.length,
        volume: 1,
        startMs: Math.round(narrationStart * 1000),
        fadeOut: false,
      });
      audioPaths.push(entry.narrationPath);
    }
    if (entry.musicPath) {
      const span = sceneSpan(durations, videoIndex, overlap);
      layers.push({
        inputIndex: videoCount + audioPaths.length,
        volume: entry.musicVolume,
        startMs: Math.round(starts[videoIndex] * 1000),
        trimTo: span,
        fadeOut: true,
      });
      audioPaths.push(entry.musicPath);
    }
    if (videoInputAudio[videoIndex]) {
      const span = sceneSpan(durations, videoIndex, overlap);
      layers.push({
        inputIndex: videoIndex,
        volume: AMBIENCE_VOLUME,
        startMs: Math.round(starts[videoIndex] * 1000),
        trimTo: span,
        fadeOut: true,
      });
    }
  });

  return {
    audioPaths,
    audioFilter: layers.length > 0 ? buildAudioFilter(layers) : null,
  };
}

function buildFfmpegArgs(options: {
  inputPaths: string[];
  audioPaths: string[];
  transitionFilter: string;
  audioFilter: string | null;
  quality: QualityPreset;
  format: "mp4" | "webm";
}): string[] {
  const args = ["-nostdin", "-hide_banner", "-y"];
  for (const input of options.inputPaths) args.push("-i", input);
  for (const input of options.audioPaths) args.push("-i", input);

  const streamLabel = options.inputPaths.length === 1 ? "0:v" : "outv";
  const outputFilter = `format=yuv420p${options.quality.scale ? `,${options.quality.scale}` : ""}`;
  const graph = [
    options.transitionFilter,
    `[${streamLabel}]${outputFilter}[final]`,
    options.audioFilter || "",
  ].filter(Boolean).join(";");

  args.push("-filter_complex", graph, "-map", "[final]");
  if (options.audioFilter) {
    args.push("-map", "[aout]");
  } else {
    args.push("-an");
  }

  if (options.format === "webm") {
    const cpuUsed = options.quality.preset === "ultrafast" ? "8"
      : options.quality.preset === "veryslow" ? "1"
        : options.quality.preset === "slow" ? "2"
          : options.quality.preset === "medium" ? "4" : "6";
    if (options.audioFilter) args.push("-c:a", "libopus", "-b:a", "128k");
    args.push("-c:v", "libvpx", "-crf", String(options.quality.crf), "-b:v", "0", "-cpu-used", cpuUsed, "-f", "webm", "pipe:1");
    return args;
  }

  if (options.audioFilter) args.push("-c:a", "aac", "-b:a", "192k");
  args.push(
    "-c:v", "libx264",
    "-preset", options.quality.preset,
    "-crf", String(options.quality.crf),
    "-pix_fmt", "yuv420p",
    "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
    "-f", "mp4",
    "pipe:1",
  );
  return args;
}

function runFfmpegToBrowser(
  args: string[],
  sink: PassThrough,
  expectedSeconds: number,
  onProgress: ProgressFn,
  signal?: AbortSignal,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child: ChildProcessWithoutNullStreams = spawn("ffmpeg", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let bytes = 0;
    let stderrTail = "";
    let lastPct = -1;
    let settled = false;
    const timeoutMs = Math.max(60_000, Number(process.env.DIRECT_EXPORT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) {
        if (!sink.destroyed) sink.destroy(error);
        reject(error);
      } else {
        resolve(bytes);
      }
    };

    const abort = () => {
      try { child.kill("SIGKILL"); } catch { /* already exited */ }
      finish(new Error("Browser download was cancelled"));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });

    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already exited */ }
      finish(new Error("Direct export timed out"));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
    });
    child.stdout.pipe(sink);

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-5000);
      if (expectedSeconds <= 0) return;
      const regex = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        const pct = Math.min(99, Math.max(0, Math.round((seconds / expectedSeconds) * 100)));
        if (pct <= lastPct) continue;
        lastPct = pct;
        void onProgress(60 + 38 * (pct / 100), "Streaming final video to your device…");
      }
    });

    child.once("error", (error) => finish(error));
    child.once("close", (code, closeSignal) => {
      if (settled) return;
      if (code === 0) finish();
      else if (closeSignal) finish(new Error(`ffmpeg stopped with signal ${closeSignal}`));
      else finish(new Error(`ffmpeg exited with code ${code}: ${stderrTail.slice(-800)}`));
    });
  });
}

async function failJob(jobId: string, projectId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : "Direct export failed";
  await db.exportJob.update({
    where: { id: jobId },
    data: {
      status: "failed",
      activeKey: null,
      step: "Download failed",
      error: message === "Browser download was cancelled"
        ? "The download was cancelled before the final video finished. Export again when ready."
        : "The final video could not be streamed to your device. Please try again.",
      updatedAt: new Date(),
    },
  }).catch(() => undefined);
  await db.videoProject.update({
    where: { id: projectId },
    data: { status: "completed" },
  }).catch(() => undefined);
}

/**
 * Render one final export directly into an HTTP response stream.
 *
 * No complete final MP4/WebM is written to generated-store or public/. Small
 * transient working files (for example a title card or a legacy remote scene
 * fallback) live under the OS temp directory and are removed on success,
 * failure, timeout, or browser cancellation.
 */
export async function streamDirectExportJob(
  jobId: string,
  sink: PassThrough,
  signal?: AbortSignal,
): Promise<void> {
  let projectId = "";
  let workDir = "";
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  try {
    const job = await db.exportJob.findUnique({ where: { id: jobId } });
    if (!job) throw new Error("Export job not found");
    projectId = job.projectId;
    if (mediaJobMode(job.params) !== "final") throw new Error("Only final exports can be downloaded directly");
    const params = parseParams(job.params);

    const project = await db.videoProject.findUnique({
      where: { id: projectId },
      include: { scenes: { orderBy: { sceneNumber: "asc" } } },
    });
    if (!project) throw new Error("Project not found");
    if (project.cutVersion !== params.expectedCutVersion || !currentCutIsReviewed(project)) {
      throw new Error("The project changed after this export was prepared. Review the current Full Preview and export again.");
    }

    const scenes = project.scenes.filter((scene) => Boolean(scene.videoUrl)) as ExportScene[];
    if (scenes.length === 0) throw new Error("No completed video scenes to export");

    const quality = QUALITY_PRESETS[params.quality];
    const transition = TRANSITIONS[params.transition];
    workDir = await mkdtemp(path.join(os.tmpdir(), "vidora-export-"));
    await mkdir(workDir, { recursive: true });

    let lastPct = -1;
    let lastStep = "";
    const onProgress: ProgressFn = async (pct, step) => {
      const rounded = Math.max(0, Math.min(99, Math.round(pct)));
      if (rounded === lastPct && step === lastStep) return;
      lastPct = rounded;
      lastStep = step;
      await db.exportJob.update({
        where: { id: jobId },
        data: { status: "running", progress: rounded, step, updatedAt: new Date() },
      }).catch(() => undefined);
    };

    heartbeat = setInterval(() => {
      db.exportJob.update({ where: { id: jobId }, data: { updatedAt: new Date() } }).catch(() => undefined);
    }, 10_000);

    await db.videoProject.update({
      where: { id: projectId },
      data: { status: "generating", finalVideoUrl: null },
    });
    await onProgress(3, "Preparing secure browser download…");

    const scenePaths = await materializeScenes(scenes, workDir, onProgress);
    const durations: number[] = [];
    const sceneHasAudio: boolean[] = [];
    for (let index = 0; index < scenePaths.length; index++) {
      durations.push(await getVideoDuration(scenePaths[index]));
      sceneHasAudio.push(params.includeAudio ? await hasAudioStream(scenePaths[index]) : false);
    }

    const { audio: sceneAudio, summary } = await collectSceneAudio(scenes, params.includeAudio, onProgress);
    const targetSize = await getVideoSize(scenePaths[0]);
    let inputPaths = [...scenePaths];
    let allDurations = [...durations];
    let videoInputAudio = [...sceneHasAudio];

    if (params.withTitleCard && project.title) {
      await onProgress(55, "Creating title card…");
      const titleCard = await generateTitleCard(workDir, project.title, targetSize);
      if (titleCard) {
        inputPaths = [titleCard, ...inputPaths];
        allDurations = [await getVideoDuration(titleCard), ...allDurations];
        videoInputAudio = [false, ...videoInputAudio];
      }
    }

    const overlap = inputPaths.length > 1 ? transition.duration : 0;
    const transitionFilter = buildTransitionFilter(allDurations, transition, targetSize);
    const { audioPaths, audioFilter } = assembleAudioGraph(
      allDurations,
      sceneAudio,
      overlap,
      videoInputAudio,
    );
    const expectedSeconds = expectedTimelineDuration(allDurations, overlap);
    const args = buildFfmpegArgs({
      inputPaths,
      audioPaths,
      transitionFilter,
      audioFilter,
      quality,
      format: params.format,
    });

    await onProgress(60, "Streaming final video to your device…");
    const fileSize = await runFfmpegToBrowser(args, sink, expectedSeconds, onProgress, signal);

    const result = {
      success: true,
      finalVideoUrl: null,
      streamedToClient: true,
      persistedOnServer: false,
      sceneCount: scenes.length,
      fileSize,
      duration: formatDuration(expectedSeconds),
      quality: quality.label,
      transition: transition.label,
      format: params.format,
      withTitleCard: params.withTitleCard,
      audio: summary,
      message: "Final video downloaded directly to this device. Vidora did not keep an exported copy on the server.",
    };

    await db.$transaction([
      db.videoProject.update({
        where: { id: projectId },
        data: { status: "completed", finalVideoUrl: null },
      }),
      db.exportJob.update({
        where: { id: jobId },
        data: {
          status: "done",
          activeKey: null,
          progress: 100,
          step: "Downloaded to device",
          result: JSON.stringify(result),
          error: null,
          updatedAt: new Date(),
        },
      }),
    ]);
  } catch (error) {
    console.error(`[direct-export] job=${jobId}`, error);
    if (projectId) await failJob(jobId, projectId, error);
    if (!sink.destroyed) sink.destroy(error instanceof Error ? error : new Error("Direct export failed"));
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
