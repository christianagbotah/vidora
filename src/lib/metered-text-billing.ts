import { BillingSafetyError } from "@/lib/provider-cost-billing";
import { getAIProviderSettings } from "@/lib/ai-provider-router";
import {
  reserveImmediateProviderOperations,
  type ImmediateProviderLineInput,
} from "@/lib/immediate-provider-billing";
import { estimateTextInputTokenCeiling } from "@/lib/zai-metered-billing";
import { resolveZaiTextBillingModel } from "@/lib/zai-billing-models";
import { submitBilledZaiText } from "@/lib/zai-billed-client";
import {
  assertBillableXaiRoute,
  submitBilledXaiText,
  XAI_BILLABLE_TEXT_MODEL,
} from "@/lib/xai-billed-client";

export type BillableTextProvider = "zai" | "xai";

function safeOutputTokenCeiling(value: number | undefined, fallback = 4_000): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(32_000, Math.ceil(parsed)));
}

export async function resolveConfiguredBillableTextRoute(requestedModel?: string | null): Promise<{
  provider: BillableTextProvider;
  model: string;
}> {
  const settings = await getAIProviderSettings();
  if (settings.textProvider === "zai") {
    return {
      provider: "zai",
      model: resolveZaiTextBillingModel(requestedModel || settings.textModel),
    };
  }
  if (settings.textProvider === "xai") {
    const model = (requestedModel || settings.textModel || settings.xaiTextModel || XAI_BILLABLE_TEXT_MODEL).trim();
    await assertBillableXaiRoute(model);
    return { provider: "xai", model };
  }
  throw new BillingSafetyError(
    "UNPRICED_TEXT_PROVIDER",
    `Text provider ${settings.textProvider} does not have a verified Billing v2 paid-text route. Configure Z.ai or xAI first.`,
  );
}

export async function reserveMeteredTextOperation(opts: {
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
}) {
  const route = await resolveConfiguredBillableTextRoute(opts.model);
  const inputTokens = estimateTextInputTokenCeiling(opts.systemPrompt, opts.userPrompt);
  const maxOutputTokens = safeOutputTokenCeiling(opts.maxOutputTokens);
  const lines: ImmediateProviderLineInput[] = [
    {
      provider: route.provider,
      model: route.model,
      operation: "text_input",
      quantity: inputTokens,
      lineKey: `${opts.lineKeyPrefix}:input`,
      label: `${opts.label} — input token ceiling`,
      sceneId: opts.sceneId ?? null,
    },
    {
      provider: route.provider,
      model: route.model,
      operation: "text_output",
      quantity: maxOutputTokens,
      lineKey: `${opts.lineKeyPrefix}:output`,
      label: `${opts.label} — output token ceiling`,
      sceneId: opts.sceneId ?? null,
    },
  ];
  const reserved = await reserveImmediateProviderOperations({
    userId: opts.userId,
    projectId: opts.projectId ?? null,
    referenceId: opts.referenceId,
    operation: `${route.provider}_text`,
    lines,
    idempotencyKey: opts.idempotencyKey,
  });
  return {
    ...reserved,
    provider: route.provider,
    model: route.model,
    inputTokens,
    maxOutputTokens,
  };
}

export async function submitBilledText(opts: {
  provider: BillableTextProvider;
  model: string;
  systemPrompt?: string | null;
  userPrompt: string;
  maxOutputTokens: number;
  thinking?: "enabled" | "disabled";
  temperature?: number;
  timeoutMs?: number;
}) {
  if (opts.provider === "xai") {
    return submitBilledXaiText(opts);
  }
  return submitBilledZaiText(opts);
}
