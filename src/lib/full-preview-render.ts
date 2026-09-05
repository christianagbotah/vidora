import crypto from "crypto";
import path from "path";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { db } from "@/lib/db";
import { generatedFilePath, generatedStoreDir, resolvePublicAssetPath } from "@/lib/generated-store";
import { generateSceneNarration, pickSceneNarrationVoice } from "@/lib/narration";
import { audioFileExists, getAudioPath } from "@/lib/audio-storage";
import { persistProviderVideo } from "@/lib/provider-video-storage";
import { zai } from "@/lib/zai";

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
  taskId: string | null;
  dialogue: string | null;
  narrationUrl: string | null;
  narrationVoice: string | null;
  narrationLang: string | null;
  narrationAccent: string | null;
  narrationStyle: string | null;
  characterIds: string | null;
  translations: Array<{ lang: string; translatedText: string | null }>;
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

async function materializeVideo(scene: PreviewScene): Promise<string> {
  if (!scene.videoUrl) throw new Error(`Scene ${scene.sceneNumber} has no generated clip`);
  if (scene.videoUrl.startsWith("/")) {
    const local = resolvePublicAssetPath(scene.videoUrl);
    if (existsSync(local)) return local;
    throw new Error(`Scene ${scene.sceneNumber} local video file is missing`);
  }

  // Legacy projects may still contain a provider-hosted URL. Archive it into
  // Vidora's persistent generated store before ffmpeg touches it. If the old
  // provider URL has expired but we still have the provider task id, refresh
  // that task once to obtain a fresh media URL before giving up.
  let providerUrl = scene.videoUrl;
  let firstError: unknown = null;
  let localUrl: string | null = null;
  try {
    localUrl = await persistProviderVideo(scene.id, providerUrl);
  } catch (error) {
    firstError = error;
  }

  if (!localUrl && scene.taskId) {
    try {
      const refreshed = await zai.pollVideoTask({
        taskId: scene.taskId,
        maxAttempts: 2,
        intervalMs: 1_500,
      });
      if (refreshed.status === "success" && refreshed.videoUrl) {
        providerUrl = refreshed.videoUrl;
        localUrl = await persistProviderVideo(scene.id, providerUrl);
      }
    } catch (refreshError) {
      console.warn(
        `[full-preview] scene=${scene.id} provider task refresh failed:`,
        refreshError instanceof Error ? refreshError.message : "unknown error",
      );
    }
  }

  if (!localUrl) {
    const detail = firstError instanceof Error ? firstError.message : "provider media unavailable";
    throw new Error(`Scene ${scene.sceneNumber} provider video could not be recovered: ${detail}`);
  }

  const localPath = resolvePublicAssetPath(localUrl);
  if (!existsSync(localPath)) throw new Error(`Scene ${scene.sceneNumber} media copy produced no local file`);
  await db.videoScene.update({
    where: { id: scene.id },
    data: { videoUrl: localUrl, errorMessage: null },
  });
  scene.videoUrl = localUrl;
  return localPath;
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

function even(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function targetCanvas(sizes: Array<{ w: number; h: number }>): { w: number; h: number } {
  const first = sizes[0];
  const maxH = 1080;
  let w = first.w;
  let h = first.h;
  if (h > maxH) {
    w *= maxH / h;
    h = maxH;
  }
  return { w: even(w), h: even(h) };
}

function transitionFilter(
  durations: number[],
  transition: FullPreviewTransition,
  size: { w: number; h: number },
): string {
  const normalize = durations.map((_, index) =>
    `[${index}:v]setpts=PTS-STARTPTS,scale=${size.w}:${size.h}:force_original_aspect_ratio=decrease,` +
    `pad=${size.w}:${size.h}:(ow-iw)/2:(oh-ih)/2:black,fps=24,format=yuv420p[v${index}]`
  );
  if (durations.length === 1) return `${normalize[0]};[v0]null[outv]`;

  const definition = TRANSITIONS[transition];
  if (definition.duration <= 0) {
    return `${normalize.join(";")};${durations.map((_, index) => `[v${index}]`).join("")}concat=n=${durations.length}:v=1:a=0[outv]`;
  }

  const chains: string[] = [];
  let previous = "v0";
  let elapsed = durations[0];
  for (let index = 1; index < durations.length; index++) {
    const overlap = Math.min(definition.duration, durations[index - 1] / 3, durations[index] / 3);
    const offset = Math.max(0, elapsed - overlap);
    const output = index === durations.length - 1 ? "outv" : `x${index}`;
    chains.push(`[${previous}][v${index}]xfade=transition=${definition.ffmpegName}:duration=${overlap.toFixed(3)}:offset=${offset.toFixed(3)}[${output}]`);
    elapsed += durations[index] - overlap;
    previous = output;
  }
  return `${normalize.join(";")};${chains.join(";")}`;
}

function sceneStarts(durations: number[], transitionDuration: number): number[] {
  const starts: number[] = [0];
  for (let index = 1; index < durations.length; index++) {
    const overlap = transitionDuration <= 0
      ? 0
      : Math.min(transitionDuration, durations[index - 1] / 3, durations[index] / 3);
    starts.push(starts[index - 1] + durations[index - 1] - overlap);
  }
  return starts;
}

function sceneSpan(durations: number[], index: number, transitionDuration: number): number {
  const overlapIn = index > 0 && transitionDuration > 0
    ? Math.min(transitionDuration, durations[index - 1] / 3, durations[index] / 3)
    : 0;
  const overlapOut = index < durations.length - 1 && transitionDuration > 0
    ? Math.min(transitionDuration, durations[index] / 3, durations[index + 1] / 3)
    : 0;
  return Math.max(0.1, durations[index] - overlapIn / 2 - overlapOut / 2);
}

function buildAudioFilter(layers: AudioLayer[]): string {
  const filters: string[] = [];
  const labels: string[] = [];
  layers.forEach((layer, index) => {
    const pieces = [
      `[${layer.inputIndex}:a]`,
      layer.trimTo ? `atrim=0:${layer.trimTo.toFixed(3)}` : "",
      "asetpts=PTS-STARTPTS",
      `volume=${layer.volume.toFixed(4)}`,
      layer.fadeOut && layer.trimTo
        ? `afade=t=out:st=${Math.max(0, layer.trimTo - Math.min(1.2, layer.trimTo / 3)).toFixed(3)}:d=${Math.min(1.2, layer.trimTo / 3).toFixed(3)}`
        : "",
      `adelay=${layer.startMs}|${layer.startMs}`,
      `[a${index}]`,
    ].filter(Boolean).join(",");
    filters.push(pieces);
    labels.push(`[a${index}]`);
  });
  filters.push(`${labels.join("")}amix=inputs=${labels.length}:duration=longest:normalize=0[aout]`);
  return filters.join(";");
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
    const language = scene.narrationLang || "en";
    let narrationText = scene.dialogue.trim();
    if (language !== "en") {
      const translated = scene.translations.find(
        (translation) => translation.lang === language && translation.translatedText?.trim(),
      );
      narrationText = translated?.translatedText?.trim() || "";
      if (!narrationText) {
        throw new Error(
          `Scene ${scene.sceneNumber} is set to ${language} but has no translated dialogue. Apply the video language again before previewing.`,
        );
      }
    }

    // Always resolve through the deterministic narration generator. It replays
    // an existing matching fingerprint without charging again, while a stale
    // provider/voice/dialogue/profile artifact receives a new fingerprint.
    const narration = await generateSceneNarration({
      sceneId: scene.id,
      text: narrationText,
      voice,
      language,
      accent: scene.narrationAccent || undefined,
      style: scene.narrationStyle || undefined,
    });
    narrationPath = narration.path;
  } else if (scene.narrationUrl) {
    const filename = scene.narrationUrl.split("?")[0].split("/").pop();
    if (filename && audioFileExists(filename)) narrationPath = getAudioPath(filename);
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
      if (error) reject(error);
      else resolve();
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
    include: { scenes: { orderBy: { sceneNumber: "asc" }, include: { translations: true } } },
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
      scenePaths.push(await materializeVideo(scenes[index]));
    }
    const sizes = await Promise.all(scenePaths.map(videoSize));
    const targetSize = targetCanvas(sizes);
    const sceneAudio = includeAudio
      ? await Promise.all(scenes.map(currentSceneAudio))
      : scenes.map(() => ({ narrationPath: null, musicPath: null, musicVolume: 0 }));
    let videoPaths = [...scenePaths];
    let durations = await Promise.all(scenePaths.map(videoDuration));
    let ambience = await Promise.all(scenePaths.map(hasAudioStream));

    if (withTitleCard) {
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
      if (ambience[videoIndex] && !sceneAudio[sceneIndex]?.narrationPath) {
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
