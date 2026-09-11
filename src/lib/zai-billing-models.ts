import {
  resolveModelForRequest,
  type VideoModelId,
} from "@/lib/video-models";

/** Current public Z.ai model ids with verified prices in the billing catalog. */
export const DEFAULT_ZAI_TEXT_MODEL_ID = "glm-4.7";
export const DEFAULT_ZAI_VISION_MODEL_ID = "glm-4.6v";
export const DEFAULT_ZAI_ASR_MODEL_ID = "glm-asr-2512";

/** Must stay aligned with the public image API model used by paid transport. */
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
 * Resolve a secondary/director text model that is intentionally independent
 * of the deployment's primary chat-model override. These calls are used by
 * supporting creative features (prompt enhancement, scene directing, etc.)
 * that must remain on a known, verified billing-catalog model unless the
 * caller explicitly requests another exact model.
 *
 * This prevents an unrelated primary override such as an older/experimental
 * ZAI_CHAT_MODEL from silently crossing an unpriced COGS boundary and making
 * creative-assist endpoints unusable. Explicit requested models are still
 * preserved so Billing v2 can fail closed when their price is unknown.
 */
export function resolveZaiSecondaryTextBillingModel(requestedModel?: string | null): string {
  const requested = (requestedModel || "").trim();
  return requested || DEFAULT_ZAI_TEXT_MODEL_ID;
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
 * Resolve the billable video model using the same input requirements as the
 * scene pipeline. A deployment override takes precedence over the project
 * choice, but it is still normalized for whether a usable reference image is
 * present. This prevents quoting an image-only Vidu model for text-only work.
 * Unknown overrides fail safely to the catalog's default through the shared
 * request resolver.
 */
export function resolveZaiVideoBillingModel(
  requestedModel: string | null | undefined,
  hasImage: boolean,
): VideoModelId {
  const forced = (process.env.ZAI_VIDEO_MODEL || "").trim();
  return resolveModelForRequest(forced || requestedModel, hasImage);
}
