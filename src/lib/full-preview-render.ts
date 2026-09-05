import crypto from "crypto";
import path from "path";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { db } from "@/lib/db";
import { generatedFilePath, generatedStoreDir, resolvePublicAssetPath } from "@/lib/generated-store";
import { generateSceneNarration, pickSceneNarrationVoice } from "@/lib/narration";

const execFileAsync = promisify(execFile);
const AMBIENCE_VOLUME = 0.6;

const TRANSITIONS = {
  fade: { ffmpegName: "fade", duration: 1.0 },
  dissolve: { ffmpegName: "dissolve", duration: 1.5 },
  wipe: { ffmpegName: "wipeleft", duration: 1.0 },
  slide: { ffmpegName: "slideleft", duration: 1.0 },
  cut: { ffmpegName: "fadeblack", duration: 0 },
} as const;

export type FullPreviewTransition = keyof typeof TRANSITIONS;

export interface FullPreviewOptions {
  transition?: FullPreviewTransition;
  withTitleCard?: boolean;
  includeAudio?: boolean;
}

export interface FullPreviewResult {
  previewVideoUrl: string;
  sceneCount: number;
  durationSeconds: number;
  transition: FullPreviewTransition;
  withTitleCard: boolean;
  includeAudio: boolean;
  voices: number;
  musicScenes: number;
  ambienceScenes: number;
}

interface PreviewScene {
  id: string;
  sceneNumber: number;
  videoUrl: string | null;
  dialogue: string | null;
  narrationUrl: string | null;
  narrationVoice: string | null;
  characterIds: string | null;
  musicTrackUrl: string | null;
  musicVolume: number;
}

interface SceneAudio {
  narrationPath: string | null;
  musicPath: string | null;
  musicVolume: number;
}

interface AudioLayer {
  inputIndex: number;
  volume: number;
  startMs: number;
  trimTo?: number;
  fadeOut: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadWithRetry(url: string, destination: string): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await writeFile(destination, Buffer.from(await response.arrayBuffer()));
      return;
    } catch (error) {
      if (attempt === 3) throw error;
      await sleep(600 * attempt);
    }
  }
}

async function materializeVideo(scene: PreviewScene, workDir: string, index: number): Promise<string> {
  if (!scene.videoUrl) throw new Error(`Scene ${scene.sceneNumber} has no generated clip`);
  if (scene.videoUrl.startsWith("/")) {
    const local = resolvePublicAssetPath(scene.videoUrl);
    if (existsSync(local)) return local;
  }
  const local = path.join(workDir, `scene_${String(index + 1).padStart(3, "0")}.mp4`);
  await downloadWithRetry(scene.videoUrl, local);
  return local;
}

async function videoDuration(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
    { timeout: 15_000 },
  );
  const value = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Could not determine duration for ${path.basename(filePath)}`);
  return value;
}

async function videoSize(filePath: string): Promise<{ w: number; h: number }> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", filePath],
    { timeout: 15_000 },
  );
  const [w, h] = stdout.trim().split(",").map((value) => Number.parseInt(value, 10));
  if (!(w > 0 && h > 0)) throw new Error(`Could not determine video size for ${path.basename(filePath)}`);
  return { w, h };
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

function normalizeInput(index: number, size: { w: number; h: number }): string {
  return (
    `[${index}:v]scale=${size.w}:${size.h}:force_original_aspect_ratio=decrease,` +
    `pad=${size.w}:${size.h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p[n${index}]`
  );
}

function transitionFilter(
  durations: number[],
  transition: FullPreviewTransition,
  size: { w: number; h: number },
): string {
  if (durations.length <= 1) return "";
  const definition = TRANSITIONS[transition];
  const normalized = durations.map((_, index) => normalizeInput(index, size));
  if (definition.duration === 0) {
    const inputs = durations.map((_, index) => `[n${index}]`).join("");
    return [...normalized, `${inputs}concat=n=${durations.length}:v=1:a=0[outv]`].join(";");
  }

  const parts = [...normalized];
  let previous = "n0";
  let offset = durations[0] - definition.duration;
  for (let index = 1; index < durations.length; index++) {
    const output = index === durations.length - 1 ? "outv" : `v${index}`;
    parts.push(
      `[${previous}][n${index}]xfade=transition=${definition.ffmpegName}:duration=${definition.duration}:offset=${Math.max(0, offset).toFixed(3)}[${output}]`,
    );
    previous = output;
    offset += durations[index] - definition.duration;
  }
  return parts.join(";");
}

function sceneStarts(durations: number[], transitionDuration: number): number[] {
  const starts: number[] = [];
  let cumulative = 0;
  for (let index = 0; index < durations.length; index++) {
    starts.push(index === 0 ? 0 : Math.max(0, cumulative - index * transitionDuration));
    cumulative += durations[index];
  }
  return starts;
}

function sceneSpan(durations: number[], index: number, transitionDuration: number): number {
  const isLast = index === durations.length - 1;
  return Math.max(0.5, isLast ? durations[index] : durations[index] - transitionDuration);
}

function buildAudioFilter(layers: AudioLayer[]): string {
  const chains: string[] = [];
  const labels: string[] = [];
  layers.forEach((layer, index) => {
    const label = `a${index}`;
    const filters = [
      "aresample=44100",
      "aformat=sample_fmts=fltp:channel_layouts=stereo",
      `volume=${layer.volume.toFixed(3)}`,
    ];
    if (layer.trimTo) {
      filters.push(`atrim=duration=${layer.trimTo.toFixed(3)}`, "asetpts=PTS-STARTPTS");
      if (layer.fadeOut) {
        filters.push(`afade=t=out:st=${Math.max(0, layer.trimTo - 0.6).toFixed(2)}:d=0.6`);
      }
    }
    if (layer.startMs > 0) filters.push(`adelay=${Math.round(layer.startMs)}:all=1`);
    chains.push(`[${layer.inputIndex}:a]${filters.join(",")}[${label}]`);
    labels.push(`[${label}]`);
  });
  chains.push(`${labels.join("")}amix=inputs=${layers.length}:duration=longest:normalize=0[aout]`);
  return chains.join(";");
}

function escapeFilterPath(value: string): string {
  return value.replace(/([:'\\])/g, "\\$1");
}

async function titleCard(
  workDir: string,
  projectTitle: string,
  size: { w: number; h: number },
): Promise<string> {
  const output = path.join(workDir, "titlecard.mp4");
  const titleFile = path.join(workDir, "title.txt");
  await writeFile(titleFile, projectTitle.slice(0, 120), "utf8");
  const fontSize = Math.max(28, Math.round(Math.min(size.w, size.h) / 15));
  const subFontSize = Math.max(16, Math.round(fontSize / 2.5));
  await execFileAsync(
    "ffmpeg",
    [
      "-nostdin", "-y",
      "-f", "lavfi", "-i", `color=c=black:s=${size.w}x${size.h}:d=3:r=24`,
      "-vf",
      `drawtext=textfile=${escapeFilterPath(titleFile)}:expansion=none:fontcolor=white:fontsize=${fontSize}:x=(w-text_w)/2:y=(h-text_h)/2-20,` +
        `drawtext=text='Vidora Studio':fontcolor=gray:fontsize=${subFontSize}:x=(w-text_w)/2:y=(h-text_h)/2+${Math.round(fontSize / 1.4)}:enable='between(t,0.3,2.7)'`,
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-t", "3", output,
    ],
    { timeout: 30_000 },
  );
  if (!existsSync(output)) throw new Error("Title card generation produced no output");
  return output;
}

async function currentSceneAudio(scene: PreviewScene): Promise<SceneAudio> {
  let narrationPath: string | null = null;
  if (scene.dialogue?.trim()) {
    const voice = await pickSceneNarrationVoice(scene);
    // Always resolve through the deterministic narration generator. It replays
    // an existing matching fingerprint without charging again, while a stale
    // provider/voice/dialogue artifact receives a new fingerprint.
    const narration = await generateSceneNarration({
      sceneId: scene.id,
      text: scene.dialogue,
      voice,
    });
    narrationPath = narration.path;
    await db.videoScene.update({
      where: { id: scene.id },
      data: { narrationUrl: narration.url, narrationVoice: voice },
    });
  } else if (scene.narrationUrl) {
    const filename = scene.narrationUrl.split("?")[0].split("/").pop();
    if (filename) {
      const candidate = resolvePublicAssetPath(`/api/audio/${filename}`);
      if (existsSync(candidate)) narrationPath = candidate;
    }
  }

  let musicPath: string | null = null;
  let musicVolume = 0;
  if (scene.musicTrackUrl) {
    const candidate = resolvePublicAssetPath(scene.musicTrackUrl);
    if (existsSync(candidate)) {
      musicVolume = Math.min(1, Math.max(0, scene.musicVolume / 100)) * 0.9;
      if (musicVolume >= 0.02) musicPath = candidate;
    }
  }
  return { narrationPath, musicPath, musicVolume };
}

function runFfmpeg(command: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-c", command], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already exited */ }
      finish(new Error("Full preview encoding timed out"));
    }, timeoutMs);
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4_000);
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code, signal) => {
      if (code === 0) finish();
      else if (signal) finish(new Error(`Full preview ffmpeg terminated by ${signal}`));
      else finish(new Error(`Full preview ffmpeg exited ${code}: ${stderr.slice(-700)}`));
    });
  });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function renderFullProjectPreview(
  projectId: string,
  expectedCutVersion: number,
  options: FullPreviewOptions = {},
): Promise<FullPreviewResult> {
  const transition = options.transition && TRANSITIONS[options.transition] ? options.transition : "fade";
  const withTitleCard = options.withTitleCard === true;
  const includeAudio = options.includeAudio !== false;
  const project = await db.videoProject.findUnique({
    where: { id: projectId },
    include: { scenes: { orderBy: { sceneNumber: "asc" } } },
  });
  if (!project) throw new Error("Project not found");
  if (project.cutVersion !== expectedCutVersion) throw new Error("Project changed before preview rendering started");
  const scenes = project.scenes as PreviewScene[];
  if (scenes.length === 0 || scenes.some((scene) => !scene.videoUrl)) {
    throw new Error("Full preview requires every scene clip to be complete");
  }

  const workDir = path.join(generatedStoreDir(), `preview_${projectId}_${crypto.randomUUID()}`);
  await mkdir(workDir, { recursive: true });
  try {
    const scenePaths: string[] = [];
    for (let index = 0; index < scenes.length; index++) {
      scenePaths.push(await materializeVideo(scenes[index], workDir, index));
    }
    const targetSize = await videoSize(scenePaths[0]);
    const sceneDurations = await Promise.all(scenePaths.map(videoDuration));
    const sceneAmbience = includeAudio
      ? await Promise.all(scenePaths.map(hasAudioStream))
      : scenePaths.map(() => false);

    const sceneAudio: SceneAudio[] = [];
    if (includeAudio) {
      for (const scene of scenes) {
        // Dialogue is mandatory content once present. Do not approve a preview
        // whose current voice failed to synthesize.
        sceneAudio.push(await currentSceneAudio(scene));
      }
    } else {
      sceneAudio.push(...scenes.map(() => ({ narrationPath: null, musicPath: null, musicVolume: 0 })));
    }

    let videoPaths = [...scenePaths];
    let durations = [...sceneDurations];
    let ambience = [...sceneAmbience];
    if (withTitleCard && project.title) {
      const card = await titleCard(workDir, project.title, targetSize);
      videoPaths = [card, ...videoPaths];
      durations = [await videoDuration(card), ...durations];
      ambience = [false, ...ambience];
    }

    const definition = TRANSITIONS[transition];
    const videoFilter = transitionFilter(durations, transition, targetSize);
    const starts = sceneStarts(durations, definition.duration);
    const sceneOffset = durations.length - scenes.length;
    const audioInputs: string[] = [];
    const audioLayers: AudioLayer[] = [];
    let voices = 0;
    let musicScenes = 0;
    let ambienceScenes = 0;

    sceneAudio.forEach((audio, sceneIndex) => {
      const videoIndex = sceneOffset + sceneIndex;
      const narrationStart = starts[videoIndex] + (definition.duration === 0 || videoIndex === 0 ? 0 : Math.min(definition.duration / 2, 0.5));
      if (audio.narrationPath) {
        audioLayers.push({
          inputIndex: videoPaths.length + audioInputs.length,
          volume: 1,
          startMs: Math.round(narrationStart * 1000),
          fadeOut: false,
        });
        audioInputs.push(audio.narrationPath);
        voices++;
      }
      if (audio.musicPath) {
        const span = sceneSpan(durations, videoIndex, definition.duration);
        audioLayers.push({
          inputIndex: videoPaths.length + audioInputs.length,
          volume: audio.musicVolume,
          startMs: Math.round(starts[videoIndex] * 1000),
          trimTo: span,
          fadeOut: true,
        });
        audioInputs.push(audio.musicPath);
        musicScenes++;
      }
      if (ambience[videoIndex]) {
        const span = sceneSpan(durations, videoIndex, definition.duration);
        audioLayers.push({
          inputIndex: videoIndex,
          volume: AMBIENCE_VOLUME,
          startMs: Math.round(starts[videoIndex] * 1000),
          trimTo: span,
          fadeOut: true,
        });
        ambienceScenes++;
      }
    });

    const videoStream = videoPaths.length === 1 ? "0:v" : "outv";
    const filterParts = [
      videoFilter,
      `[${videoStream}]format=yuv420p,scale=-2:720[final]`,
      audioLayers.length ? buildAudioFilter(audioLayers) : "",
    ].filter(Boolean);
    const outputPath = path.join(workDir, "preview.mp4");
    const inputs = [
      ...videoPaths.map((item) => `-i ${shellQuote(item)}`),
      ...audioInputs.map((item) => `-i ${shellQuote(item)}`),
    ].join(" ");
    const command = [
      "ffmpeg -nostdin -y",
      inputs,
      `-filter_complex ${shellQuote(filterParts.join(";"))}`,
      `-map '[final]'`,
      audioLayers.length ? `-map '[aout]' -c:a aac -b:a 160k` : "-an",
      "-c:v libx264 -preset veryfast -crf 24 -pix_fmt yuv420p -movflags +faststart",
      shellQuote(outputPath),
    ].join(" ");
    await runFfmpeg(command, 600_000);
    if (!existsSync(outputPath)) throw new Error("Full preview produced no output file");

    // Re-read the version after all deterministic TTS writes. narrationUrl is
    // deliberately not a cut-version source, so a mismatch here means a real
    // user/project edit raced the render and the preview must not be approved.
    const current = await db.videoProject.findUnique({
      where: { id: projectId },
      select: { cutVersion: true },
    });
    if (!current || current.cutVersion !== expectedCutVersion) {
      throw new Error("Project changed while the full preview was rendering");
    }

    const outputName = `preview_${projectId}_${expectedCutVersion}_${Date.now()}.mp4`;
    const persistentPath = generatedFilePath(outputName);
    await mkdir(path.dirname(persistentPath), { recursive: true });
    await writeFile(persistentPath, await readFile(outputPath));
    return {
      previewVideoUrl: `/generated/${outputName}`,
      sceneCount: scenes.length,
      durationSeconds: await videoDuration(persistentPath),
      transition,
      withTitleCard,
      includeAudio,
      voices,
      musicScenes,
      ambienceScenes,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
