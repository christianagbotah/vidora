import crypto from "crypto";
import { db } from "@/lib/db";
import { getAIProviderSettings } from "@/lib/ai-provider-router";
import {
  createBillingQuote,
  getBillingQuote,
  type BillingQuoteLine,
} from "@/lib/credit-reservations";
import {
  BillingSafetyError,
  getCommercialPricingPolicy,
  quoteProviderCharge,
} from "@/lib/provider-cost-billing";
import {
  assertQwenTtsConfigured,
  resolveQwenTtsModel,
  splitQwenTtsInput,
} from "@/lib/qwen-tts";

export const TALKING_PHOTO_SPEECH_MAX_CHARS = 3_000;
export const TALKING_PHOTO_SPEECH_VOICES = [
  "tongtong",
  "xiaochen",
  "jam",
  "kazi",
  "douji",
  "luodo",
  "chuichui",
] as const;
export const TALKING_PHOTO_SPEECH_LANGUAGES = [
  "en", "fr", "de", "it", "pt", "es", "ja", "ko", "ru", "zh",
] as const;

export type TalkingPhotoSpeechInput = {
  script: string;
  voice?: string | null;
  language?: string | null;
  accent?: string | null;
};

export function normalizeTalkingPhotoSpeechInput(input: TalkingPhotoSpeechInput) {
  const script = String(input.script || "").replace(/\s+/g, " ").trim();
  if (!script) throw new BillingSafetyError("INVALID_TTS_SCRIPT", "Enter speech text before reviewing cost.");
  if (script.length > TALKING_PHOTO_SPEECH_MAX_CHARS) {
    throw new BillingSafetyError(
      "INVALID_TTS_SCRIPT",
      `Scripted Talking Photo speech is limited to ${TALKING_PHOTO_SPEECH_MAX_CHARS} characters per job.`,
    );
  }
  const requestedVoice = String(input.voice || "tongtong").trim().toLowerCase();
  const voice = (TALKING_PHOTO_SPEECH_VOICES as readonly string[]).includes(requestedVoice)
    ? requestedVoice
    : "tongtong";
  const requestedLanguage = String(input.language || "en").trim().toLowerCase();
  if (!(TALKING_PHOTO_SPEECH_LANGUAGES as readonly string[]).includes(requestedLanguage)) {
    throw new BillingSafetyError("INVALID_TTS_SCRIPT", "Select a supported scripted-speech language.");
  }
  const accent = String(input.accent || "auto").trim().replace(/\s+/g, " ").slice(0, 64) || "auto";
  return { script, voice, language: requestedLanguage, accent };
}

export function talkingPhotoSpeechFingerprint(input: {
  script: string;
  voice: string;
  language: string;
  accent: string;
  model: string;
}): string {
  return crypto.createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex");
}

export function talkingPhotoSpeechLineKey(jobId: string, index: number): string {
  return `talking-photo-speech:${jobId}:chunk:${index}`;
}

export async function createTalkingPhotoSpeechQuote(opts: {
  userId: string;
  input: TalkingPhotoSpeechInput;
}) {
  await assertQwenTtsConfigured();
  const normalized = normalizeTalkingPhotoSpeechInput(opts.input);
  const settings = await getAIProviderSettings();
  if (settings.ttsProvider !== "qwen") {
    throw new BillingSafetyError(
      "UNPRICED_TTS_PROVIDER",
      `Scripted Talking Photo speech requires the verified Qwen Billing v2 TTS route; current provider is ${settings.ttsProvider}.`,
    );
  }
  const model = resolveQwenTtsModel(settings.ttsModel);
  const chunks = splitQwenTtsInput(normalized.script);
  if (!chunks.length) throw new BillingSafetyError("INVALID_TTS_SCRIPT", "No speakable text was found.");
  const fingerprint = talkingPhotoSpeechFingerprint({ ...normalized, model });

  const replay = await db.talkingPhotoSpeechJob.findFirst({
    where: {
      userId: opts.userId,
      fingerprint,
      status: "completed",
      outputAssetId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    include: { outputAsset: true },
  });
  if (replay?.outputAsset) {
    return {
      replayed: true as const,
      job: replay,
      asset: replay.outputAsset,
      normalized,
      model,
      chunks,
      fingerprint,
    };
  }

  const jobId = crypto.randomUUID();
  const policy = await getCommercialPricingPolicy();
  const lines: BillingQuoteLine[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const quantity = Math.max(1, chunks[index].length);
    const charge = await quoteProviderCharge({
      provider: "qwen",
      model,
      operation: "tts",
      quantity,
      policy,
    });
    lines.push({
      ...charge,
      lineKey: talkingPhotoSpeechLineKey(jobId, index),
      label: `Scripted Talking Photo speech part ${index + 1}/${chunks.length} (${quantity} chars)`,
    });
  }
  const quote = await createBillingQuote({
    userId: opts.userId,
    operation: "talking_photo_speech",
    lines,
    policy,
  });
  const job = await db.talkingPhotoSpeechJob.create({
    data: {
      id: jobId,
      userId: opts.userId,
      fingerprint,
      scriptText: normalized.script,
      voice: normalized.voice,
      language: normalized.language,
      accent: normalized.accent,
      model,
      status: "quoted",
      billingQuoteId: quote.id,
      chunkCount: chunks.length,
    },
  });
  return {
    replayed: false as const,
    job,
    quote,
    normalized,
    model,
    chunks,
    fingerprint,
  };
}

export async function requireMatchingTalkingPhotoSpeechQuote(job: {
  id: string;
  userId: string;
  scriptText: string;
  voice: string;
  language: string;
  accent: string;
  model: string;
  billingQuoteId: string;
  chunkCount: number;
}) {
  const quote = await getBillingQuote(job.billingQuoteId);
  if (!quote || quote.userId !== job.userId || quote.operation !== "talking_photo_speech") {
    throw new BillingSafetyError("TTS_QUOTE_SCOPE_CHANGED", "Scripted speech quote no longer matches this job.");
  }
  if (quote.status !== "open") {
    throw new BillingSafetyError("TTS_QUOTE_SCOPE_CHANGED", `Scripted speech quote is already ${quote.status}.`);
  }
  if (quote.expiresAt.getTime() <= Date.now()) {
    throw new BillingSafetyError("TTS_QUOTE_SCOPE_CHANGED", "Scripted speech quote expired; review the cost again.");
  }
  const normalized = normalizeTalkingPhotoSpeechInput({
    script: job.scriptText,
    voice: job.voice,
    language: job.language,
    accent: job.accent,
  });
  const fingerprint = talkingPhotoSpeechFingerprint({ ...normalized, model: job.model });
  const chunks = splitQwenTtsInput(normalized.script);
  if (chunks.length !== job.chunkCount || quote.breakdown.length !== chunks.length) {
    throw new BillingSafetyError("TTS_QUOTE_SCOPE_CHANGED", "Scripted speech chunks changed after cost review.");
  }
  for (let index = 0; index < chunks.length; index += 1) {
    const line = quote.breakdown[index];
    if (
      line.lineKey !== talkingPhotoSpeechLineKey(job.id, index)
      || line.provider !== "qwen"
      || line.model !== job.model
      || line.operation !== "tts"
      || Math.abs(line.quantity - Math.max(1, chunks[index].length)) > 1e-9
    ) {
      throw new BillingSafetyError("TTS_QUOTE_SCOPE_CHANGED", "Scripted speech pricing changed after cost review.");
    }
  }
  return { quote, normalized, fingerprint, chunks };
}
