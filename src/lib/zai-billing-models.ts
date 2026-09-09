import {
  DEFAULT_VIDEO_MODEL_ID,
  getVideoModelInfo,
  resolveModelForRequest,
  type VideoModelId,
} from "@/lib/video-models";

/** Current public Z.ai model ids with verified prices in the billing catalog. */
export const DEFAULT_ZAI_TEXT_MODEL_ID = "glm-4.7";
export const DEFAULT_ZAI_VISION_MODEL_ID = "glm-4.6v";
export const DEFAULT_ZAI_ASR_MODEL_ID = "glm-asr-2512";

/** Must stay aligned with the public image API model used by src/lib/zai.ts. */
export const DEFAULT_ZAI_IMAGE_MODEL_ID = "cogview-4-250304";

/**
 * Resolve the exact text model sent by direct Z.ai chat calls. A configured
 * model is preserved even when it is unknown so the verified provider-price
 * lookup can fail closed before provider spend.
 */
export function resolveZaiTextBillingModel(requestedModel?: string | null): string {
  const requested = (requestedModel || "").trim();
  const configured = (process.env.ZAI_CHAT_MODEL || "").trim();
  return requested || configured || DEFAULT_ZAI_TEXT_MODEL_ID;
}

/**
 * Resolve the exact multimodal model sent by Z.ai vision calls. Do not fall
 * back to the text-model environment variable: a text-only model may be valid
 * for chat but invalid/unpriced for video or image understanding.
 */
export function resolveZaiVisionBillingModel(requestedModel?: string | null): string {
  const requested = (requestedModel || "").trim();
  const configured = (process.env.ZAI_VISION_MODEL || "").trim();
  return requested || configured || DEFAULT_ZAI_VISION_MODEL_ID;
}

export function resolveZaiAsrBillingModel(): string {
  const configured = (process.env.ZAI_ASR_MODEL || "").trim();
  return configured || DEFAULT_ZAI_ASR_MODEL_ID;
}

/**
 * Resolve the exact image model the provider transport will send. Unknown
 * operator overrides are deliberately preserved so the billing catalog fails
 * closed before any unpriced provider request can be made.
 */
export function resolveZaiImageBillingModel(): string {
  const configured = (process.env.ZAI_IMAGE_MODEL || "").trim();
  return configured || DEFAULT_ZAI_IMAGE_MODEL_ID;
}

/**
 * Mirror createVideoCompat's ZAI_VIDEO_MODEL override. A recognized operator
 * override wins over the project selection. An unknown override is handled by
 * the transport as CogVideoX-3, so billing must use that same fallback.
 */
export function resolveZaiVideoBillingModel(
  requestedModel: string | null | undefined,
  hasImage: boolean,
): VideoModelId {
  const forced = (process.env.ZAI_VIDEO_MODEL || "").trim();
  if (forced) return getVideoModelInfo(forced)?.id ?? DEFAULT_VIDEO_MODEL_ID;
  return resolveModelForRequest(requestedModel, hasImage);
}
