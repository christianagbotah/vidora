/**
 * ───────────────────────────────────────────────────────────────────────────
 *  Vidora — Shared Scene Narration (TTS) Library
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Generates narration audio (WAV) for a scene's dialogue using Z.ai TTS.
 * Shared by:
 *   - POST /api/generate-narration   (studio "Narrate" button)
 *   - POST /api/export-video         (auto-voices during final export)
 *
 * Files are written to the OS temp dir (/tmp/vidora-audio) via bash so they
 * land on the REAL filesystem (Turbopack intercepts fs writes in dev — see
 * src/lib/audio-storage.ts) and are served by /api/audio/<filename>.
 */

import { zai } from "@/lib/zai";
import { db } from "@/lib/db";
import { execFile, execFileSync } from "child_process";
import { promisify } from "util";
import { unlink } from "fs/promises";
import path from "path";
import { writeAudioFile, deleteAudioFile, getAudioPath, ensureAudioDir } from "@/lib/audio-storage";

const execFileAsync = promisify(execFile);

// Default TTS voice catalog (kept in sync with the frontend picker)
export const TTS_VOICES = [
  { id: "tongtong", label: "TongTong", desc: "Warm & friendly (narrator)" },
  { id: "chuichui", label: "ChuiChui", desc: "Playful & cute (kids)" },
  { id: "xiaochen", label: "XiaoChen", desc: "Professional & calm" },
  { id: "jam", label: "Jam", desc: "British gentleman" },
  { id: "kazi", label: "Kazi", desc: "Clear & standard" },
  { id: "douji", label: "DouJi", desc: "Natural & smooth" },
  { id: "luodo", label: "LuoDo", desc: "Expressive & engaging" },
];

export const DEFAULT_TTS_VOICE = "tongtong";

/** Split text into chunks that fit within the TTS char limit. */
export function splitTextIntoChunks(text: string, maxLen = 900): string[] {
  if (text.length <= maxLen) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if ((current + sentence).length <= maxLen) {
      current += sentence;
    } else {
      if (current) chunks.push(current.trim());
      current = sentence;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text.slice(0, maxLen)];
}

/**
 * Concatenate wav chunks via ffmpeg's concat demuxer.
 * For single-chunk, copies the file to the output path.
 * Uses bash for file operations to bypass Turbopack's fs interception.
 */
export async function concatWavChunks(chunkPaths: string[], outputPath: string): Promise<boolean> {
  if (chunkPaths.length === 1) {
    try {
      execFileSync("bash", ["-c", `cp "${chunkPaths[0]}" "${outputPath}"`]);
      return true;
    } catch (err) {
      console.error("[narration] single-chunk copy failed:", err);
      return false;
    }
  }
  const listFile = outputPath + ".concat.txt";
  const listContent = chunkPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  execFileSync("bash", ["-c", `cat > "${listFile}"`], { input: listContent });
  try {
    await execFileAsync("ffmpeg", [
      "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outputPath,
    ], { timeout: 30_000 });
    execFileSync("bash", ["-c", `rm -f "${listFile}"`]);
    return true;
  } catch (err) {
    console.error("[narration] ffmpeg concat failed:", err);
    execFileSync("bash", ["-c", `rm -f "${listFile}"`]);
    return false;
  }
}

export interface NarrationResult {
  /** Public URL for the audio file (served by /api/audio/<filename>) */
  url: string;
  /** Absolute filesystem path of the final wav */
  path: string;
  /** Number of TTS chunks generated */
  chunks: number;
  /** Whether chunks were concatenated into one file */
  concatenated: boolean;
}

/**
 * Generate narration audio for a scene via Z.ai TTS and persist it to the
 * audio store. Does NOT write to the database — callers own the DB update.
 * Throws on TTS failure (callers decide how to degrade).
 */
export async function generateSceneNarration(opts: {
  sceneId: string;
  text: string;
  voice?: string;
  speed?: number;
}): Promise<NarrationResult> {
  const { sceneId, text, voice = DEFAULT_TTS_VOICE, speed = 1.0 } = opts;
  const clampedSpeed = Math.max(0.5, Math.min(2.0, speed || 1.0));

  ensureAudioDir();
  const chunks = splitTextIntoChunks(text);
  const tempChunkPaths: string[] = [];

  try {
    for (let i = 0; i < chunks.length; i++) {
      const arrayBuffer = await zai.tts({
        input: chunks[i],
        voice,
        speed: clampedSpeed,
        retry: { label: `TTS chunk ${i + 1}/${chunks.length}`, timeoutMs: 120_000, maxRetries: 4 },
      });

      const buffer = Buffer.from(new Uint8Array(arrayBuffer));
      // Z.ai TTS returns WAV audio (API rejects "mp3" response_format).
      const chunkFilename = `chunk_${sceneId}_${i}_${Date.now()}.wav`;
      tempChunkPaths.push(writeAudioFile(chunkFilename, buffer));
    }

    const finalFilename = `narration_${sceneId}_${Date.now()}.wav`;
    const finalPath = getAudioPath(finalFilename);
    const concatenated = await concatWavChunks(tempChunkPaths, finalPath);

    let url: string;
    let resolvedPath: string;
    if (concatenated) {
      url = `/api/audio/${finalFilename}`;
      resolvedPath = finalPath;
      for (const p of tempChunkPaths) {
        deleteAudioFile(path.basename(p));
      }
    } else {
      // Fallback: use the first chunk
      url = `/api/audio/${path.basename(tempChunkPaths[0])}`;
      resolvedPath = tempChunkPaths[0];
    }

    return { url, path: resolvedPath, chunks: chunks.length, concatenated };
  } catch (err) {
    // Clean up any orphaned chunk files on failure
    for (const p of tempChunkPaths) {
      await unlink(p).catch(() => {});
    }
    throw err;
  }
}

// ─── Auto-narration (generation flow) ────────────────────────────────────────

/** The scene fields the voice picker needs. */
export interface NarratableScene {
  id: string;
  dialogue?: string | null;
  narrationUrl?: string | null;
  narrationVoice?: string | null;
  characterIds?: string | null;
}

/**
 * Pick the best TTS voice for a scene: explicit scene voice → any linked
 * character's assigned voice → the default narrator. Shared by the
 * generation flow (auto-voices right after a scene renders) and the final
 * export (fallback for scenes that never got a voice).
 */
export async function pickSceneNarrationVoice(scene: NarratableScene): Promise<string> {
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

export interface AutoNarrateResult {
  ok: boolean;
  /** Public /api/audio/... URL when a voice was generated (or already existed). */
  url?: string;
  /** Why nothing was generated — useful for logs, never user-facing. */
  reason?: string;
}

/**
 * Ensure a scene with dialogue has a voice: if it has no narrationUrl yet,
 * generate the TTS with the best-matching voice and persist it. Called by
 * the generation routes the moment a scene's video completes, so character
 * voices exist in the studio immediately — the export then simply reuses
 * them instead of generating from scratch.
 *
 * NON-FATAL by contract: never throws. A failed TTS just leaves the scene
 * voiceless (the export's auto-voice pass is the safety net).
 */
export async function autoNarrateScene(sceneId: string): Promise<AutoNarrateResult> {
  try {
    const scene = await db.videoScene.findUnique({
      where: { id: sceneId },
      select: { id: true, dialogue: true, narrationUrl: true, narrationVoice: true, characterIds: true },
    });
    if (!scene) return { ok: false, reason: "scene not found" };
    if (scene.narrationUrl) return { ok: true, url: scene.narrationUrl };
    if (!scene.dialogue || scene.dialogue.trim().length === 0) {
      return { ok: false, reason: "no dialogue" };
    }

    const voice = await pickSceneNarrationVoice(scene);
    console.log(`[autoNarrate] scene=${sceneId} generating voice (voice=${voice})…`);
    const result = await generateSceneNarration({
      sceneId: scene.id,
      text: scene.dialogue,
      voice,
    });
    await db.videoScene.update({
      where: { id: scene.id },
      data: { narrationUrl: result.url, narrationVoice: voice },
    });
    console.log(`[autoNarrate] scene=${sceneId} voice ready: ${result.url}`);
    return { ok: true, url: result.url };
  } catch (err) {
    console.warn(`[autoNarrate] scene=${sceneId} voice generation failed (non-fatal):`, err);
    return { ok: false, reason: "tts failed" };
  }
}
