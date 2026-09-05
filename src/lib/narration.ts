/**
 * Vidora — shared scene narration (TTS) library.
 *
 * Every billable scene TTS call passes through this module. Dialogue is kept
 * speaker-aware so character conversations are synthesized as intentional
 * lines instead of being flattened into one generic narrator voice.
 */

import crypto from "crypto";
import { db } from "@/lib/db";
import { PRICING } from "@/lib/pricing";
import { deductTokensForOperation } from "@/lib/tokens";
import { execFile } from "child_process";
import { promisify } from "util";
import { copyFile, unlink, writeFile } from "fs/promises";
import path from "path";
import {
  getAIProviderSettings,
  synthesizeProviderSpeech,
} from "@/lib/ai-provider-router";
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

const ATTRIBUTION_CAPTURE_RE =
  /^\s*((?:Narrator|Chorus|All|Everyone|[A-Z][A-Za-z'’.-]*(?:\s+[A-Z][A-Za-z'’.-]*)*)(?:\s*[&,+]\s*(?:and\s+)?[A-Z][A-Za-z'’.-]*(?:\s+[A-Z][A-Za-z'’.-]*)*)?(?:\s*\([^)]*\))?)\s*:\s*(.*)$/;

function cleanSpokenText(value: string): string {
  return value
    .trim()
    .replace(/^["\u201C]+/, "")
    .replace(/["\u201D]+$/, "")
    .trim();
}

export function stripSpeakerAttributions(text: string): string {
  return text
    .split("\n")
    .map((line) => cleanSpokenText(line.replace(ATTRIBUTION_PREFIX_RE, "")))
    .filter(Boolean)
    .join(" ")
    .trim();
}

export interface DialogueSegment {
  speaker: string | null;
  /** Optional screenplay performance cue kept separate from spoken words. */
  direction: string | null;
  text: string;
}

function performanceCueFromSpeakerLabel(label: string): string | null {
  const match = label.match(/\(([^()]*)\)\s*$/);
  const cue = match?.[1]?.trim().replace(/\s+/g, " ").slice(0, 64) || "";
  return cue || null;
}

/**
 * Parse screenplay-style dialogue without losing speaker identity or delivery
 * direction. Continuation lines are attached to the preceding speaker so
 * multiline model output still becomes one coherent performance.
 */
export function parseDialogueSegments(text: string): DialogueSegment[] {
  const segments: DialogueSegment[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const attributed = line.match(ATTRIBUTION_CAPTURE_RE);
    if (attributed) {
      const rawSpeaker = attributed[1].trim();
      const direction = performanceCueFromSpeakerLabel(rawSpeaker);
      const speaker = rawSpeaker
        .replace(/\s*\([^)]*\)\s*$/, "")
        .trim();
      const spoken = cleanSpokenText(attributed[2]);
      if (spoken) segments.push({ speaker, direction, text: spoken });
      continue;
    }

    const spoken = cleanSpokenText(line);
    if (!spoken) continue;
    const previous = segments[segments.length - 1];
    if (previous) previous.text = `${previous.text} ${spoken}`.trim();
    else segments.push({ speaker: null, direction: null, text: spoken });
  }
  return segments;
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

/**
 * Normalize provider output (WAV or MP3) into one PCM WAV file. Re-encoding is
 * deliberate: mixed provider chunks may not share codecs/containers, and a
 * stream-copy concat can produce an invalid file with a .wav extension.
 */
export async function concatWavChunks(chunkPaths: string[], outputPath: string): Promise<boolean> {
  if (chunkPaths.length === 0) return false;
  if (chunkPaths.length === 1 && path.extname(chunkPaths[0]).toLowerCase() === ".wav") {
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
      [
        "-nostdin", "-y", "-f", "concat", "-safe", "0", "-i", listFile,
        "-vn", "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", outputPath,
      ],
      { timeout: 60_000 }
    );
    return true;
  } catch (err) {
    console.error(
      "[narration] ffmpeg audio concat failed:",
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

interface PlannedSpeechChunk {
  speaker: string | null;
  direction: string | null;
  text: string;
  voice: string;
}

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function speakerCandidates(speaker: string): string[] {
  const clean = speaker
    .replace(/\s+(?:and|&)\s+/gi, "|")
    .replace(/\s*[,+]\s*/g, "|");
  return clean.split("|").map(normalizeName).filter(Boolean);
}

function narrationFingerprint(opts: {
  sceneId: string;
  chunks: PlannedSpeechChunk[];
  speed: number;
  provider: string;
  providerModel: string;
  providerVoiceConfig: unknown;
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

async function buildSpeechPlan(opts: {
  text: string;
  defaultVoice: string;
  characterIds: string | null;
}): Promise<PlannedSpeechChunk[]> {
  const segments = parseDialogueSegments(opts.text);
  if (segments.length === 0) return [];

  const characterVoice = new Map<string, string>();
  try {
    const ids: unknown = JSON.parse(opts.characterIds || "[]");
    if (Array.isArray(ids) && ids.length > 0) {
      const chars = await db.character.findMany({
        where: { id: { in: ids.filter((id): id is string => typeof id === "string") } },
        select: { name: true, voiceId: true },
      });
      for (const character of chars) {
        characterVoice.set(normalizeName(character.name), character.voiceId || opts.defaultVoice);
      }
    }
  } catch {
    // Malformed legacy characterIds simply use the default logical voice.
  }

  const output: PlannedSpeechChunk[] = [];
  for (const segment of segments) {
    let voice = opts.defaultVoice;
    if (segment.speaker) {
      for (const candidate of speakerCandidates(segment.speaker)) {
        const matched = characterVoice.get(candidate);
        if (matched) {
          voice = matched;
          break;
        }
      }
    }
    for (const chunk of splitTextIntoChunks(segment.text, 700)) {
      output.push({
        speaker: segment.speaker,
        direction: segment.direction,
        text: chunk,
        voice,
      });
    }
  }
  return output;
}

/**
 * Generate a complete scene performance and charge the owning user exactly
 * once for the logical performance. Each explicitly attributed character line
 * may use that character's configured voice; group/narrator lines use the
 * scene default voice. Performance direction is kept out of the spoken text
 * and is passed to providers as structured metadata.
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
      characterIds: true,
      project: { select: { userId: true } },
    },
  });
  if (!scene) throw new Error("Scene not found");
  const userId = scene.project.userId;
  if (!userId) {
    throw new Error("Guest/demo projects cannot use billable narration generation");
  }

  const defaultVoice = (opts.voice || DEFAULT_TTS_VOICE).trim().toLowerCase();
  const speed = Math.max(0.5, Math.min(2, Number(opts.speed) || 1));
  if (!opts.text.trim()) throw new Error("No speakable text");
  if (opts.text.length > 12_000) throw new Error("Narration text is too long");

  const chunks = await buildSpeechPlan({
    text: opts.text,
    defaultVoice,
    characterIds: scene.characterIds,
  });
  if (chunks.length === 0) throw new Error("No speakable dialogue was found");

  const providerSettings = await getAIProviderSettings();
  const providerModel = providerSettings.ttsProvider === "elevenlabs"
    ? (providerSettings.ttsModel || "eleven_v3")
    : (providerSettings.ttsModel || "zai-tts");
  const fingerprint = narrationFingerprint({
    sceneId: scene.id,
    chunks,
    speed,
    provider: providerSettings.ttsProvider,
    providerModel,
    providerVoiceConfig: providerSettings.ttsProvider === "elevenlabs"
      ? {
          default: providerSettings.elevenLabsDefaultVoiceId,
          map: providerSettings.elevenLabsVoiceMap,
        }
      : null,
  });
  const finalFilename = narrationFilename(scene.id, fingerprint);
  const finalPath = getAudioPath(finalFilename);
  const finalUrl = `/api/audio/${finalFilename}`;
  const operationKey = `tts:${userId}:${scene.id}:${fingerprint}`;
  const tokensToCharge = chunks.length * PRICING.tts.tokens;
  const costUsd = chunks.length * PRICING.tts.costUsd;

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
    description: `Generate ${chunks.length}-part scene dialogue performance for scene ${scene.id}`,
    referenceId: scene.id,
    idempotencyKey: operationKey,
    customTokens: tokensToCharge,
    customCostUsd: costUsd,
  });
  if (!deduction.success) {
    throw new Error(deduction.error || "Insufficient tokens for narration generation");
  }

  if (audioFileExists(finalFilename)) {
    // narrationVoice is an explicit/user source setting. A voice resolved from a
    // linked character must remain derived so later character-voice edits can
    // flow through pickSceneNarrationVoice instead of being shadowed by stale
    // scene state.
    await db.videoScene.update({
      where: { id: scene.id },
      data: { narrationUrl: finalUrl },
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
      const speech = await synthesizeProviderSpeech({
        input: chunks[i].text,
        voice: chunks[i].voice,
        direction: chunks[i].direction,
        speed,
      });
      const tempFilename = `chunk_${scene.id}_${fingerprint}_${i}_${crypto.randomUUID()}.${speech.extension}`;
      tempChunkPaths.push(writeAudioFile(tempFilename, speech.buffer));
    }

    const concatenated = await concatWavChunks(tempChunkPaths, finalPath);
    let url = finalUrl;
    let resolvedPath = finalPath;

    if (concatenated) {
      for (const p of tempChunkPaths) deleteAudioFile(path.basename(p));
    } else {
      // Provider work has already been consumed. Preserve the first successful
      // chunk as a recoverable result instead of discarding paid audio.
      url = `/api/audio/${path.basename(tempChunkPaths[0])}`;
      resolvedPath = tempChunkPaths[0];
    }

    await db.videoScene.update({
      where: { id: scene.id },
      data: { narrationUrl: url },
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
    // Do not auto-refund an ambiguous provider request. Retrying the exact
    // performance fingerprint reuses the existing token transaction.
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
 * Non-fatal automatic dialogue performance. The shared generator performs
 * billable ownership and token charging before any TTS provider request.
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
