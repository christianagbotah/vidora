/**
 * Vidora — shared scene narration (TTS) library.
 *
 * Every provider TTS call for scene narration passes through this module.
 * Billing is therefore enforced at the provider boundary rather than being
 * left to individual API routes or background callers.
 */

import crypto from "crypto";
import { zai } from "@/lib/zai";
import { db } from "@/lib/db";
import { PRICING } from "@/lib/pricing";
import { deductTokensForOperation } from "@/lib/tokens";
import { execFile } from "child_process";
import { promisify } from "util";
import { copyFile, unlink, writeFile } from "fs/promises";
import path from "path";
import {
  writeAudioFile,
  deleteAudioFile,
  getAudioPath,
  ensureAudioDir,
  audioFileExists,
} from "@/lib/audio-storage";

const execFileAsync = promisify(execFile);

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

const ATTRIBUTION_PREFIX_RE =
  /^\s*(?:Narrator|Chorus|All|Everyone|[A-Z][A-Za-z'’.-]*(?:\s+[A-Z][A-Za-z'’.-]*)*)(?:\s*[&,+]\s*(?:and\s+)?[A-Z][A-Za-z'’.-]*(?:\s+[A-Z][A-Za-z'’.-]*)*)?(?:\s*\([^)]*\))?\s*:\s*/;

export function stripSpeakerAttributions(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .replace(ATTRIBUTION_PREFIX_RE, "")
        .trim()
        .replace(/^["\u201C]+/, "")
        .replace(/["\u201D]+$/, "")
        .trim()
    )
    .filter(Boolean)
    .join(" ")
    .trim();
}

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

export async function concatWavChunks(chunkPaths: string[], outputPath: string): Promise<boolean> {
  if (chunkPaths.length === 1) {
    try {
      await copyFile(chunkPaths[0], outputPath);
      return true;
    } catch (err) {
      console.error(
        "[narration] single-chunk copy failed:",
        err instanceof Error ? err.message : "unknown error"
      );
      return false;
    }
  }

  const listFile = `${outputPath}.concat.txt`;
  const listContent = chunkPaths
    .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
    .join("\n");
  try {
    await writeFile(listFile, listContent, "utf8");
    await execFileAsync(
      "ffmpeg",
      ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outputPath],
      { timeout: 30_000 }
    );
    return true;
  } catch (err) {
    console.error(
      "[narration] ffmpeg concat failed:",
      err instanceof Error ? err.message : "unknown error"
    );
    return false;
  } finally {
    await unlink(listFile).catch(() => undefined);
  }
}

export interface NarrationResult {
  url: string;
  path: string;
  chunks: number;
  concatenated: boolean;
  tokensCharged: number;
  remainingTokens?: number;
  transactionId?: string;
  replayed?: boolean;
}

function narrationFingerprint(opts: {
  sceneId: string;
  text: string;
  voice: string;
  speed: number;
}): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(opts), "utf8")
    .digest("hex")
    .slice(0, 24);
}

function narrationFilename(sceneId: string, fingerprint: string): string {
  const safeScene = sceneId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  return `narration_${safeScene}_${fingerprint}.wav`;
}

/**
 * Generate narration and charge the owning user exactly once for the logical
 * text/voice/speed operation. A failed/ambiguous provider call is NOT
 * automatically refunded: retrying the same intent reuses the same token
 * transaction instead of charging the user again.
 */
export async function generateSceneNarration(opts: {
  sceneId: string;
  text: string;
  voice?: string;
  speed?: number;
}): Promise<NarrationResult> {
  const scene = await db.videoScene.findUnique({
    where: { id: opts.sceneId },
    select: {
      id: true,
      narrationUrl: true,
      project: { select: { userId: true } },
    },
  });
  if (!scene) throw new Error("Scene not found");
  const userId = scene.project.userId;
  if (!userId) {
    throw new Error("Guest/demo projects cannot use billable narration generation");
  }

  const voice = (opts.voice || DEFAULT_TTS_VOICE).toLowerCase();
  const speed = Math.max(0.5, Math.min(2, Number(opts.speed) || 1));
  const text = stripSpeakerAttributions(opts.text);
  if (!text) {
    throw new Error("No speakable text after stripping speaker attributions");
  }
  if (text.length > 12_000) {
    throw new Error("Narration text is too long");
  }

  const chunks = splitTextIntoChunks(text);
  const fingerprint = narrationFingerprint({ sceneId: scene.id, text, voice, speed });
  const finalFilename = narrationFilename(scene.id, fingerprint);
  const finalPath = getAudioPath(finalFilename);
  const finalUrl = `/api/audio/${finalFilename}`;
  const operationKey = `tts:${userId}:${scene.id}:${fingerprint}`;
  const tokensToCharge = chunks.length * PRICING.tts.tokens;
  const costUsd = chunks.length * PRICING.tts.costUsd;

  // A matching persisted file is reusable only when the ledger also proves
  // that this exact logical operation was charged previously.
  if (scene.narrationUrl === finalUrl && audioFileExists(finalFilename)) {
    const existingCharge = await db.tokenTransaction.findUnique({
      where: { idempotencyKey: operationKey },
      select: { id: true, userId: true },
    });
    if (existingCharge?.userId === userId) {
      const balance = await db.user.findUnique({
        where: { id: userId },
        select: { tokens: true },
      });
      return {
        url: finalUrl,
        path: finalPath,
        chunks: chunks.length,
        concatenated: true,
        tokensCharged: 0,
        remainingTokens: balance?.tokens,
        transactionId: existingCharge.id,
        replayed: true,
      };
    }
  }

  const deduction = await deductTokensForOperation({
    userId,
    operation: "tts",
    description: `Generate narration for scene ${scene.id} (${chunks.length} TTS call${chunks.length === 1 ? "" : "s"})`,
    referenceId: scene.id,
    idempotencyKey: operationKey,
    customTokens: tokensToCharge,
    customCostUsd: costUsd,
  });
  if (!deduction.success) {
    throw new Error(deduction.error || "Insufficient tokens for narration generation");
  }

  // If the file appeared between the pre-check and the atomic debit, reuse it.
  // This covers concurrent retries without another provider call.
  if (audioFileExists(finalFilename)) {
    await db.videoScene.update({
      where: { id: scene.id },
      data: { narrationUrl: finalUrl, narrationVoice: voice },
    });
    return {
      url: finalUrl,
      path: finalPath,
      chunks: chunks.length,
      concatenated: true,
      tokensCharged: deduction.alreadyApplied ? 0 : tokensToCharge,
      remainingTokens: deduction.remainingTokens,
      transactionId: deduction.transactionId,
      replayed: true,
    };
  }

  ensureAudioDir();
  const tempChunkPaths: string[] = [];
  try {
    for (let i = 0; i < chunks.length; i++) {
      const arrayBuffer = await zai.tts({
        input: chunks[i],
        voice,
        speed,
        retry: {
          label: `TTS chunk ${i + 1}/${chunks.length}`,
          timeoutMs: 120_000,
          maxRetries: 4,
        },
      });
      const buffer = Buffer.from(new Uint8Array(arrayBuffer));
      const tempFilename = `chunk_${scene.id}_${fingerprint}_${i}_${crypto.randomUUID()}.wav`;
      tempChunkPaths.push(writeAudioFile(tempFilename, buffer));
    }

    const concatenated = await concatWavChunks(tempChunkPaths, finalPath);
    let url = finalUrl;
    let resolvedPath = finalPath;

    if (concatenated) {
      for (const p of tempChunkPaths) deleteAudioFile(path.basename(p));
    } else {
      // Provider work was already consumed, so keep the successful first chunk
      // as a recoverable result rather than refunding an ambiguous operation.
      url = `/api/audio/${path.basename(tempChunkPaths[0])}`;
      resolvedPath = tempChunkPaths[0];
    }

    await db.videoScene.update({
      where: { id: scene.id },
      data: { narrationUrl: url, narrationVoice: voice },
    });

    return {
      url,
      path: resolvedPath,
      chunks: chunks.length,
      concatenated,
      tokensCharged: deduction.alreadyApplied ? 0 : tokensToCharge,
      remainingTokens: deduction.remainingTokens,
      transactionId: deduction.transactionId,
      replayed: false,
    };
  } catch (err) {
    for (const p of tempChunkPaths) {
      await unlink(p).catch(() => undefined);
    }
    // Do not auto-refund. A provider timeout/failure can be ambiguous, and
    // retrying this exact fingerprint will reuse the existing charge.
    throw err;
  }
}

export interface NarratableScene {
  id: string;
  dialogue?: string | null;
  narrationUrl?: string | null;
  narrationVoice?: string | null;
  characterIds?: string | null;
}

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
  } catch {
    // Legacy malformed characterIds falls back to the default voice.
  }
  return DEFAULT_TTS_VOICE;
}

export interface AutoNarrateResult {
  ok: boolean;
  url?: string;
  reason?: string;
}

/**
 * Non-fatal automatic narration. The shared generator performs authorization
 * of billable ownership and token charging before any TTS provider request.
 */
export async function autoNarrateScene(sceneId: string): Promise<AutoNarrateResult> {
  try {
    const scene = await db.videoScene.findUnique({
      where: { id: sceneId },
      select: {
        id: true,
        dialogue: true,
        narrationUrl: true,
        narrationVoice: true,
        characterIds: true,
      },
    });
    if (!scene) return { ok: false, reason: "scene not found" };
    if (scene.narrationUrl) return { ok: true, url: scene.narrationUrl };
    if (!scene.dialogue || scene.dialogue.trim().length === 0) {
      return { ok: false, reason: "no dialogue" };
    }

    const voice = await pickSceneNarrationVoice(scene);
    const result = await generateSceneNarration({
      sceneId: scene.id,
      text: scene.dialogue,
      voice,
    });
    return { ok: true, url: result.url };
  } catch (err) {
    console.warn(
      `[autoNarrate] scene=${sceneId} voice generation skipped/failed:`,
      err instanceof Error ? err.message : "unknown error"
    );
    return { ok: false, reason: "tts unavailable or not funded" };
  }
}
