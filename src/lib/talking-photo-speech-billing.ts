import crypto from "crypto";
import { getAIProviderSettings } from "@/lib/ai-provider-router-qwen";
import {
  BillingSafetyError,
  getCommercialPricingPolicy,
  quoteProviderCharge,
} from "@/lib/provider-cost-billing";
import {
  createBillingQuote,
  getBillingQuote,
  type BillingQuoteLine,
} from "@/lib/credit-reservations";
import { getConfigValue } from "@/lib/secure-config";
import {
  resolveQwenTtsModel,
  splitQwenTtsInput,
} from "@/lib/qwen-tts";

export const TALKING_PHOTO_SPEECH_MAX_CHARS = 3_500;

export interface TalkingPhotoSpeechSpec {
  script: string;
  voice: string;
  language: string | null;
  accent: string | null;
  style: string | null;
}

export function normalizeTalkingPhotoSpeechSpec(input: {
  script?: unknown;
  voice?: unknown;
  language?: unknown;
  accent?: unknown;
  style?: unknown;
}): TalkingPhotoSpeechSpec {
  const script = String(input.script ?? "").replace(/\s+/g, " ").trim();
  if (!script) throw new Error("Enter what the digital actor should say");
  if (script.length > TALKING_PHOTO_SPEECH_MAX_CHARS) {
    throw new Error(`Script must be ${TALKING_PHOTO_SPEECH_MAX_CHARS.toLocaleString()} characters or fewer`);
  }
  const voice = String(input.voice ?? "tongtong").trim().toLowerCase().slice(0, 80) || "tongtong";
  const nullable = (value: unknown, max: number) => {
    const text = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
    return text || null;
  };
  return {
    script,
    voice,
    language: nullable(input.language, 40),
    accent: nullable(input.accent, 80),
    style: nullable(input.style, 120),
  };
}

export function talkingPhotoSpeechChunks(script: string): string[] {
  return splitQwenTtsInput(script.trim());
}

export function talkingPhotoSpeechFingerprint(spec: TalkingPhotoSpeechSpec, model: string): string {
  return crypto.createHash("sha256").update(JSON.stringify({
    script: spec.script,
    voice: spec.voice,
    language: spec.language,
    accent: spec.accent,
    style: spec.style,
    model,
  }), "utf8").digest("hex");
}

export function talkingPhotoSpeechLineKey(fingerprint: string, index: number): string {
  return `talking-photo-speech:${fingerprint}:${index}`;
}

export async function resolveTalkingPhotoSpeechModel(): Promise<string> {
  const settings = await getAIProviderSettings();
  if (settings.ttsProvider !== "qwen") {
    throw new BillingSafetyError(
      "UNPRICED_TTS_PROVIDER",
      "Scripted Digital Actor voice generation currently requires Qwen TTS because that provider has verified Billing v2 pricing.",
    );
  }
  const key = await getConfigValue("qwen_tts_api_key", "DASHSCOPE_API_KEY");
  if (!key) {
    throw new BillingSafetyError(
      "QWEN_TTS_NOT_CONFIGURED",
      "Qwen TTS is not configured. Add the DashScope key in Admin Providers before generating Digital Actor speech.",
    );
  }
  return resolveQwenTtsModel(settings.ttsModel);
}

export async function createTalkingPhotoSpeechQuote(opts: {
  userId: string;
  spec: TalkingPhotoSpeechSpec;
}) {
  const model = await resolveTalkingPhotoSpeechModel();
  const fingerprint = talkingPhotoSpeechFingerprint(opts.spec, model);
  const chunks = talkingPhotoSpeechChunks(opts.spec.script);
  if (!chunks.length) throw new Error("No speakable text was found");

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
      lineKey: talkingPhotoSpeechLineKey(fingerprint, index),
      label: `Digital Actor voice part ${index + 1} (${quantity} chars)`,
      sceneId: null,
    });
  }
  const quote = await createBillingQuote({
    userId: opts.userId,
    operation: "talking_photo_speech",
    lines,
    policy,
  });
  return { quote, model, fingerprint, chunks };
}

export async function requireMatchingTalkingPhotoSpeechQuote(opts: {
  quoteId: string;
  userId: string;
  spec: TalkingPhotoSpeechSpec;
}) {
  const quote = await getBillingQuote(opts.quoteId);
  if (!quote || quote.userId !== opts.userId) {
    throw new BillingSafetyError("BILLING_QUOTE_NOT_FOUND", "Voice quote was not found");
  }
  if (quote.operation !== "talking_photo_speech") {
    throw new BillingSafetyError("BILLING_QUOTE_SCOPE_CHANGED", "Voice quote belongs to another operation");
  }
  if (quote.status !== "open") {
    throw new BillingSafetyError("BILLING_QUOTE_NOT_OPEN", `Voice quote is already ${quote.status}`);
  }
  if (quote.expiresAt.getTime() <= Date.now()) {
    throw new BillingSafetyError("BILLING_QUOTE_EXPIRED", "Voice quote expired; review the cost again");
  }

  const model = await resolveTalkingPhotoSpeechModel();
  const fingerprint = talkingPhotoSpeechFingerprint(opts.spec, model);
  const chunks = talkingPhotoSpeechChunks(opts.spec.script);
  if (quote.breakdown.length !== chunks.length) {
    throw new BillingSafetyError("TTS_QUOTE_SCOPE_CHANGED", "Script changed after the voice quote was created");
  }
  for (let index = 0; index < chunks.length; index += 1) {
    const line = quote.breakdown[index];
    const quantity = Math.max(1, chunks[index].length);
    if (
      line.lineKey !== talkingPhotoSpeechLineKey(fingerprint, index) ||
      line.provider !== "qwen" ||
      line.model !== model ||
      line.operation !== "tts" ||
      Math.abs(line.quantity - quantity) > 1e-9
    ) {
      throw new BillingSafetyError("TTS_QUOTE_SCOPE_CHANGED", "Script, voice, model or price scope changed after quote");
    }
  }
  return { quote, model, fingerprint, chunks };
}
