import { BillingSafetyError, getCommercialPricingPolicy, quoteProviderCharge } from "@/lib/provider-cost-billing";
import {
  captureImmediateProviderOperations,
  reserveImmediateProviderOperations,
  type ImmediateProviderLineInput,
} from "@/lib/immediate-provider-billing";
import { getAIProviderSettings } from "@/lib/ai-provider-router";
import {
  resolveZaiAsrBillingModel,
  resolveZaiTextBillingModel,
  resolveZaiVisionBillingModel,
} from "@/lib/zai-billing-models";

const TEXT_CONTEXT_TOKEN_CEILING = 128_000;
const VISION_CONTEXT_TOKEN_CEILING = 128_000;

/**
 * UTF-8 byte count is deliberately used as a conservative pre-provider token
 * ceiling for plain text. It safely overestimates normal language/code token
 * counts while remaining bounded by the model context window.
 */
export function estimateTextInputTokenCeiling(...parts: Array<string | null | undefined>): number {
  const bytes = parts.reduce((sum, part) => sum + Buffer.byteLength(part || "", "utf8"), 0);
  return Math.max(1, Math.min(TEXT_CONTEXT_TOKEN_CEILING, bytes));
}

function safeOutputTokenCeiling(value: number | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(32_000, Math.ceil(parsed)));
}

export async function resolveConfiguredBillableZaiTextModel(requestedModel?: string | null): Promise<string> {
  const settings = await getAIProviderSettings();
  if (settings.textProvider !== "zai") {
    throw new BillingSafetyError(
      "UNPRICED_TEXT_PROVIDER",
      `Text provider ${settings.textProvider} does not have a verified cost catalog in Billing v2. Configure Z.ai before paid AI text work.`,
    );
  }
  return resolveZaiTextBillingModel(requestedModel || settings.textModel);
}

function textLines(opts: {
  model: string;
  inputTokens: number;
  maxOutputTokens: number;
  lineKeyPrefix: string;
  label: string;
}): ImmediateProviderLineInput[] {
  return [
    {
      provider: "zai",
      model: opts.model,
      operation: "text_input",
      quantity: opts.inputTokens,
      lineKey: `${opts.lineKeyPrefix}:input`,
      label: `${opts.label} — input token ceiling`,
    },
    {
      provider: "zai",
      model: opts.model,
      operation: "text_output",
      quantity: opts.maxOutputTokens,
      lineKey: `${opts.lineKeyPrefix}:output`,
      label: `${opts.label} — output token ceiling`,
    },
  ];
}

export async function reserveMeteredZaiTextOperation(opts: {
  userId: string;
  projectId?: string | null;
  sceneId?: string | null;
  referenceId: string;
  idempotencyKey: string;
  lineKeyPrefix: string;
  label: string;
  systemPrompt?: string | null;
  userPrompt: string;
  maxOutputTokens?: number;
  model?: string | null;
  requireConfiguredPrimary?: boolean;
}) {
  const model = opts.requireConfiguredPrimary === false
    ? resolveZaiTextBillingModel(opts.model)
    : await resolveConfiguredBillableZaiTextModel(opts.model);
  const inputTokens = estimateTextInputTokenCeiling(opts.systemPrompt, opts.userPrompt);
  const maxOutputTokens = safeOutputTokenCeiling(opts.maxOutputTokens, 4_000);
  const lines = textLines({
    model,
    inputTokens,
    maxOutputTokens,
    lineKeyPrefix: opts.lineKeyPrefix,
    label: opts.label,
  }).map((line) => ({ ...line, sceneId: opts.sceneId ?? null }));
  const reserved = await reserveImmediateProviderOperations({
    userId: opts.userId,
    projectId: opts.projectId ?? null,
    referenceId: opts.referenceId,
    operation: "zai_text",
    lines,
    idempotencyKey: opts.idempotencyKey,
  });
  return { ...reserved, model, inputTokens, maxOutputTokens };
}

export async function captureMeteredZaiTextOperation(opts: {
  reservationId: string;
  lineKeyPrefix: string;
  userId: string;
  projectId?: string | null;
  sceneId?: string | null;
}) {
  return captureImmediateProviderOperations({
    reservationId: opts.reservationId,
    lineKeys: [`${opts.lineKeyPrefix}:input`, `${opts.lineKeyPrefix}:output`],
    userId: opts.userId,
    projectId: opts.projectId ?? null,
    sceneId: opts.sceneId ?? null,
  });
}

/**
 * Quote a free/CAC text attempt from the verified catalog without debiting the
 * customer. Callers use providerCostUsd to record the platform expense. The
 * billing kill-switch and stale-price rules still apply.
 */
export async function quoteFreeZaiTextAttempt(opts: {
  systemPrompt?: string | null;
  userPrompt: string;
  maxOutputTokens?: number;
  model?: string | null;
  requireConfiguredPrimary?: boolean;
}) {
  const model = opts.requireConfiguredPrimary === false
    ? resolveZaiTextBillingModel(opts.model)
    : await resolveConfiguredBillableZaiTextModel(opts.model);
  const policy = await getCommercialPricingPolicy();
  const inputTokens = estimateTextInputTokenCeiling(opts.systemPrompt, opts.userPrompt);
  const maxOutputTokens = safeOutputTokenCeiling(opts.maxOutputTokens, 4_000);
  const [input, output] = await Promise.all([
    quoteProviderCharge({ provider: "zai", model, operation: "text_input", quantity: inputTokens, policy }),
    quoteProviderCharge({ provider: "zai", model, operation: "text_output", quantity: maxOutputTokens, policy }),
  ]);
  return {
    model,
    inputTokens,
    maxOutputTokens,
    providerCostUsd: input.providerCostUsd + output.providerCostUsd,
    pricingVersion: `${input.pricingVersion}+${output.pricingVersion}`,
  };
}

export async function reserveMeteredZaiVisionOperation(opts: {
  userId: string;
  referenceId: string;
  idempotencyKey: string;
  lineKeyPrefix: string;
  label: string;
  maxOutputTokens?: number;
  model?: string | null;
}) {
  const model = resolveZaiVisionBillingModel(opts.model);
  const maxOutputTokens = safeOutputTokenCeiling(opts.maxOutputTokens, 4_000);
  // Multimodal tokenization depends on uploaded media. Reserving the model's
  // maximum context window is conservative and prevents underfunded provider
  // work without trying to guess image/video tokenization from file bytes.
  const lines: ImmediateProviderLineInput[] = [
    {
      provider: "zai",
      model,
      operation: "vision_input",
      quantity: VISION_CONTEXT_TOKEN_CEILING,
      lineKey: `${opts.lineKeyPrefix}:input`,
      label: `${opts.label} — multimodal input ceiling`,
    },
    {
      provider: "zai",
      model,
      operation: "vision_output",
      quantity: maxOutputTokens,
      lineKey: `${opts.lineKeyPrefix}:output`,
      label: `${opts.label} — output token ceiling`,
    },
  ];
  const reserved = await reserveImmediateProviderOperations({
    userId: opts.userId,
    referenceId: opts.referenceId,
    operation: "zai_vision",
    lines,
    idempotencyKey: opts.idempotencyKey,
  });
  return { ...reserved, model, inputTokens: VISION_CONTEXT_TOKEN_CEILING, maxOutputTokens };
}

export async function captureMeteredZaiVisionOperation(opts: {
  reservationId: string;
  lineKeyPrefix: string;
  userId: string;
}) {
  return captureImmediateProviderOperations({
    reservationId: opts.reservationId,
    lineKeys: [`${opts.lineKeyPrefix}:input`, `${opts.lineKeyPrefix}:output`],
    userId: opts.userId,
  });
}

export async function reserveMeteredZaiAsrOperation(opts: {
  userId: string;
  referenceId: string;
  idempotencyKey: string;
  lineKey: string;
  label: string;
  durationSeconds: number;
}) {
  if (!Number.isFinite(opts.durationSeconds) || opts.durationSeconds <= 0) {
    throw new BillingSafetyError("INVALID_ASR_DURATION", "Audio duration must be known before paid transcription.");
  }
  const model = resolveZaiAsrBillingModel();
  const minutes = Math.max(1 / 60, opts.durationSeconds / 60);
  const reserved = await reserveImmediateProviderOperations({
    userId: opts.userId,
    referenceId: opts.referenceId,
    operation: "zai_asr",
    lines: [{
      provider: "zai",
      model,
      operation: "asr",
      quantity: minutes,
      lineKey: opts.lineKey,
      label: opts.label,
    }],
    idempotencyKey: opts.idempotencyKey,
  });
  return { ...reserved, model, minutes };
}
