import {
  DEFAULT_VIDEO_MODEL_ID,
  getVideoModelInfo,
  resolveModelForRequest,
  type VideoModelId,
} from "@/lib/video-models";

/** Must stay aligned with the public image API model used by src/lib/zai.ts. */
export const DEFAULT_ZAI_IMAGE_MODEL_ID = "cogview-4-250304";

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
