/**
 * Vidora — shared scene narration (Qwen TTS) library.
 *
 * Every paid Qwen request is backed by a prepaid credit reservation. Quote
 * lines, provider calls and deterministic local chunk files share the same
 * chunk index so a crash cannot silently resubmit paid speech work.
 */

import crypto from "crypto";
import { db } from "@/lib/db";
import { execFile } from "child_process";
import { promisify } from "util";
import { copyFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { getAIProviderSettings } from "@/lib/ai-provider-router-qwen";
import {
  resolveQwenTtsModel,
  splitQwenTtsInput,
  synthesizeQwenTts,
} from "@/lib/qwen-tts";
import {
  BillingSafetyError,
  getCommercialPricingPolicy,
  quoteProviderCharge,
} from "@/lib/provider-cost-billing";
import {
  captureReservedQuoteLine,
  createBillingQuote,
  findReservationByReference,
  getWalletSummary,
  reserveBillingQuote,
  type BillingQuoteLine,
} from "@/lib/credit-reservations";
import {
  narrationBillableTextChunks,
  parseNarrationTextSegments,
} from "@/lib/narration-billing";
import {
  buildNarrationPerformanceDirection,
  normalizeNarrationProfile,
  type NarrationProfile,
} from "@/lib/narration-profile";
import {
  writeAudioFile,
  deleteAudioFile,
  getAudioPath,
  ensureAudioDir,
  audioFileExists,
} from "@/lib/audio-storage";

const execFileAsync = promisify(execFile);

export { narrationBillableTextChunks } from "@/lib/narration-billing";

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
  direction: string | null;
  text: string;
}

export function parseDialogueSegments(text: string): DialogueSegment[] {
  return parseNarrationTextSegments(text);
}

/** Legacy helper retained for callers/tests outside the Qwen billing path. */
export function splitTextIntoChunks(text: string, maxLen = 900): string[] {
  if (text.length <= maxLen) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if ((current + sentence).length <= maxLen) current += sentence;
    else {
      if (current) chunks.push(current.trim());
      current = sentence;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text.slice(0, maxLen)];
}

export async function concatWavChunks(chunkPaths: string[], outputPath: string): Promise<boolean> {
  if (chunkPaths.length === 0) return false;
  if (chunkPaths.length === 1 && path.extname(chunkPaths[0]).toLowerCase() === ".wav") {
    try {
      await copyFile(chunkPaths[0], outputPath);
      return true;
    } catch (err) {
      console.error("[narration] single-chunk copy failed:", err instanceof Error ? err.message : "unknown error");
      return false;
    }
  }

  const listFile = `${outputPath}.concat.txt`;
  const listContent = chunkPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  try {
    await writeFile(listFile, listContent, "utf8");
    await execFileAsync(
      "ffmpeg",
      [
        "-nostdin", "-y", "-f", "concat", "-safe", "0", "-i", listFile,
        "-vn", "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", outputPath,
      ],
      { timeout: 60_000 },
    );
    return true;
  } catch (err) {
    console.error("[narration] ffmpeg audio concat failed:", err instanceof Error ? err.message : "unknown error");
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
  profile: NarrationProfile;
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
  profile: NarrationProfile;
  providerModel: string;
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

function narrationChunkFilename(
  sceneId: string,
  fingerprint: string,
  index: number,
  extension: "wav" | "mp3",
): string {
  const safeScene = sceneId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  return `narration_chunk_${safeScene}_${fingerprint}_${String(index).padStart(3, "0")}.${extension}`;
}

function existingNarrationChunkPath(sceneId: string, fingerprint: string, index: number): string | null {
  for (const extension of ["wav", "mp3"] as const) {
    const filename = narrationChunkFilename(sceneId, fingerprint, index, extension);
    if (audioFileExists(filename)) return getAudioPath(filename);
  }
  return null;
}

async function buildSpeechPlan(opts: {
  text: string;
  defaultVoice: string;
  characterIds: string | null;
  profile: NarrationProfile;
}): Promise<PlannedSpeechChunk[]> {
  const segments = parseNarrationTextSegments(opts.text);
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
    for (const text of splitQwenTtsInput(segment.text)) {
      output.push({
        speaker: segment.speaker,
        direction: buildNarrationPerformanceDirection(opts.profile, segment.direction),
        text,
        voice,
      });
    }
  }
  return output;
}

async function buildNarrationQuoteLines(opts: {
  sceneId: string;
  chunks: PlannedSpeechChunk[];
  providerModel: string;
}): Promise<{ lines: BillingQuoteLine[]; policy: Awaited<ReturnType<typeof getCommercialPricingPolicy>> }> {
  const policy = await getCommercialPricingPolicy();
  const lines: BillingQuoteLine[] = [];
  for (let index = 0; index < opts.chunks.length; index += 1) {
    const chunk = opts.chunks[index];
    const charge = await quoteProviderCharge({
      provider: "qwen",
      model: opts.providerModel,
      operation: "tts",
      quantity: Math.max(1, chunk.text.length),
      policy,
    });
    lines.push({
      ...charge,
      lineKey: `tts:${opts.sceneId}:${index}`,
      label: `Qwen narration part ${index + 1} (${Math.max(1, chunk.text.length)} chars)`,
      sceneId: opts.sceneId,
    });
  }
  return { lines, policy };
}

export async function generateSceneNarration(opts: {
  sceneId: string;
  text: string;
  voice?: string;
  speed?: number;
  language?: string;
  accent?: string;
  style?: string;
  billingReservationId?: string;
  generationRunId?: string;
}): Promise<NarrationResult> {
  const scene = await db.videoScene.findUnique({
    where: { id: opts.sceneId },
    select: {
      id: true,
      narrationUrl: true,
      narrationLang: true,
      narrationAccent: true,
      narrationStyle: true,
      characterIds: true,
      project: { select: { id: true, userId: true } },
    },
  });
  if (!scene) throw new Error("Scene not found");
  const userId = scene.project.userId;
  if (!userId) throw new Error("Guest/demo projects cannot use billable narration generation");

  const defaultVoice = (opts.voice || DEFAULT_TTS_VOICE).trim().toLowerCase();
  const speed = Math.max(0.5, Math.min(2, Number(opts.speed) || 1));
  const profile = normalizeNarrationProfile({
    language: opts.language || scene.narrationLang || undefined,
    accent: opts.accent || scene.narrationAccent || undefined,
    style: opts.style || scene.narrationStyle || undefined,
  });
  if (!opts.text.trim()) throw new Error("No speakable text");
  if (opts.text.length > 12_000) throw new Error("Narration text is too long");

  const providerSettings = await getAIProviderSettings();
  if (providerSettings.ttsProvider !== "qwen") {
    throw new BillingSafetyError(
      "UNPRICED_TTS_PROVIDER",
      `Narration provider ${providerSettings.ttsProvider} is not enabled for paid billing. Configure Qwen TTS before generating narration.`,
    );
  }
  const providerModel = resolveQwenTtsModel(providerSettings.ttsModel);
  const chunks = await buildSpeechPlan({
    text: opts.text,
    defaultVoice,
    characterIds: scene.characterIds,
    profile,
  });
  if (chunks.length === 0) throw new Error("No speakable dialogue was found");

  const fingerprint = narrationFingerprint({
    sceneId: scene.id,
    chunks,
    speed,
    profile,
    providerModel,
  });
  const finalFilename = narrationFilename(scene.id, fingerprint);
  const finalPath = getAudioPath(finalFilename);
  const finalUrl = `/api/audio/${finalFilename}`;
  const operationKey = `tts:${userId}:${scene.id}:${fingerprint}`;

  // Deterministic final media is a safe replay: no provider call and no new
  // reservation are needed when the same performance already exists locally.
  if (audioFileExists(finalFilename)) {
    await db.videoScene.update({
      where: { id: scene.id },
      data: {
        narrationUrl: finalUrl,
        narrationLang: profile.language,
        narrationAccent: profile.accent,
        narrationStyle: profile.style,
      },
    });
    const wallet = await getWalletSummary(userId);
    return {
      url: finalUrl,
      path: finalPath,
      chunks: chunks.length,
      concatenated: true,
      tokensCharged: 0,
      remainingTokens: wallet.availableCredits,
      replayed: true,
      profile,
    };
  }

  let reservationId = opts.billingReservationId || "";
  let wallet = await getWalletSummary(userId);
  if (!reservationId) {
    const prior = await findReservationByReference(operationKey);
    if (prior && prior.userId === userId) {
      reservationId = prior.id;
    } else {
      const { lines, policy } = await buildNarrationQuoteLines({
        sceneId: scene.id,
        chunks,
        providerModel,
      });
      const quote = await createBillingQuote({
        userId,
        projectId: scene.project.id,
        operation: "tts",
        lines,
        policy,
      });
      const reserved = await reserveBillingQuote({
        quoteId: quote.id,
        userId,
        referenceId: operationKey,
        idempotencyKey: `${operationKey}:reservation`,
      });
      reservationId = reserved.reservation.id;
      wallet = reserved.wallet;
    }
  }

  ensureAudioDir();
  const chunkPaths: string[] = [];
  let newlyCapturedCredits = 0;
  try {
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const existingPath = existingNarrationChunkPath(scene.id, fingerprint, index);
      if (existingPath) {
        await captureReservedQuoteLine({
          reservationId,
          lineKey: `tts:${scene.id}:${index}`,
          userId,
          projectId: scene.project.id,
          sceneId: scene.id,
          generationRunId: opts.generationRunId ?? null,
        });
        chunkPaths.push(existingPath);
        continue;
      }

      const capture = await captureReservedQuoteLine({
        reservationId,
        lineKey: `tts:${scene.id}:${index}`,
        userId,
        projectId: scene.project.id,
        sceneId: scene.id,
        generationRunId: opts.generationRunId ?? null,
      });
      if (capture.alreadyCaptured) {
        // We know this paid line crossed the accounting boundary previously,
        // but there is no deterministic audio artifact. Resubmitting would risk
        // paying Qwen twice for one customer charge, so require reconciliation.
        throw new BillingSafetyError(
          "AMBIGUOUS_TTS_RETRY",
          `Narration part ${index + 1} was previously funded but its audio result is missing. Automatic Qwen resubmission is blocked.`,
        );
      }
      newlyCapturedCredits += capture.creditsCaptured;

      const speech = await synthesizeQwenTts({
        input: chunk.text,
        voice: chunk.voice,
        language: profile.language,
        accent: profile.accent,
        direction: chunk.direction,
        speed,
        model: providerModel,
      });
      const chunkFilename = narrationChunkFilename(scene.id, fingerprint, index, speech.extension);
      chunkPaths.push(writeAudioFile(chunkFilename, speech.buffer));
    }

    const concatenated = await concatWavChunks(chunkPaths, finalPath);
    if (!concatenated) {
      throw new Error("Qwen narration was generated and preserved, but Vidora could not assemble the final audio file. Retry will reuse the preserved chunks without another provider call.");
    }

    for (const chunkPath of chunkPaths) deleteAudioFile(path.basename(chunkPath));
    await db.videoScene.update({
      where: { id: scene.id },
      data: {
        narrationUrl: finalUrl,
        narrationLang: profile.language,
        narrationAccent: profile.accent,
        narrationStyle: profile.style,
      },
    });
    wallet = await getWalletSummary(userId);

    return {
      url: finalUrl,
      path: finalPath,
      chunks: chunks.length,
      concatenated: true,
      tokensCharged: newlyCapturedCredits,
      remainingTokens: wallet.availableCredits,
      replayed: false,
      profile,
    };
  } catch (error) {
    // Preserve deterministic chunk files. They are the proof that a specific
    // funded Qwen part completed and let a retry avoid a duplicate provider call.
    throw error;
  }
}

export interface NarratableScene {
  id: string;
  dialogue?: string | null;
  narrationUrl?: string | null;
  narrationVoice?: string | null;
  narrationLang?: string | null;
  narrationAccent?: string | null;
  narrationStyle?: string | null;
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

export async function autoNarrateScene(
  sceneId: string,
  billing?: { reservationId?: string; generationRunId?: string },
): Promise<AutoNarrateResult> {
  try {
    const scene = await db.videoScene.findUnique({
      where: { id: sceneId },
      select: {
        id: true,
        dialogue: true,
        narrationUrl: true,
        narrationVoice: true,
        narrationLang: true,
        narrationAccent: true,
        narrationStyle: true,
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
      language: scene.narrationLang || undefined,
      accent: scene.narrationAccent || undefined,
      style: scene.narrationStyle || undefined,
      billingReservationId: billing?.reservationId,
      generationRunId: billing?.generationRunId,
    });
    return { ok: true, url: result.url };
  } catch (err) {
    console.warn(
      `[autoNarrate] scene=${sceneId} voice generation skipped/failed:`,
      err instanceof Error ? err.message : "unknown error",
    );
    return { ok: false, reason: err instanceof Error ? err.message : "tts unavailable or not funded" };
  }
}
