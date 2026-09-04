/**
 * Video Generation Model Catalog
 * ──────────────────────────────
 * Vidora can render through multiple Z.ai video engines. This module is the
 * single source of truth for WHICH models exist, their transport-level
 * constraints (validated against the official docs.z.ai Video API), and the
 * UI metadata shown in the model picker.
 *
 * VERIFIED MODEL LINEUP (official docs.z.ai pricing, Sep 2026):
 *   vidu2-image      Image-to-Video        4s   720P   $0.20/clip
 *   vidu2-reference  Reference-to-Video     4s   720P   $0.40/clip (1–7 refs)
 *   viduq1-text      Text-to-Video          5s   1080P  $0.40/clip (style: anime/general)
 *   viduq1-image     Image-to-Video         5s   1080P  $0.40/clip
 *   CogVideoX-3      Text/Image-to-Video   5/10s up to 4K  $0.20/clip
 *
 * NOTE — vidu2-start-end / viduq1-start-end are intentionally NOT offered:
 * they require exactly two input frames (first + last) which our scene
 * pipeline cannot supply yet.
 *
 * This module is imported from BOTH client and server code — it must stay
 * dependency-free (no SDK, no DB, no Node-only APIs).
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type VideoModelId =
  | "CogVideoX-3"
  | "vidu2-image"
  | "vidu2-reference"
  | "viduq1-text"
  | "viduq1-image";

export type VideoModelFamily = "cogvideox" | "vidu2" | "viduq1";

/** How the transport layer should shape the `image_url` field. */
export type VideoImageMode = "none" | "single" | "array" | "any";

export interface VideoModelInfo {
  /** Exact API model id — sent as `model` in the request body. */
  id: VideoModelId;
  /** Short display name. */
  name: string;
  family: VideoModelFamily;
  familyLabel: string;
  /** Positioning badge shown in the picker. */
  tierLabel: string;
  /** One-line pitch. */
  tagline: string;
  /** 2–3 strength bullets for the picker. */
  strengths: string[];
  /** REAL Z.ai cost per generated clip (USD) — from the official price sheet. */
  costUsd: number;
  /** Default clip duration in seconds (per official docs). */
  durationSec: number;
  /** Resolution label. */
  resolution: string;
  /** What this model accepts as visual input. */
  imageMode: VideoImageMode;
  /** True when the model can generate without any image (text prompt only). */
  textCapable: boolean;
  /** Vidu `aspect_ratio` support (CogVideoX uses explicit sizes instead). */
  supportsAspectRatio: boolean;
  /** ViduQ1-text `style` param support ("general" | "anime"). */
  supportsStyle: boolean;
  /** Emphasized in the picker. */
  isDefault?: boolean;
}

// ─── Catalog ────────────────────────────────────────────────────────────────

export const DEFAULT_VIDEO_MODEL_ID: VideoModelId = "CogVideoX-3";

export const VIDEO_MODELS: VideoModelInfo[] = [
  {
    id: "CogVideoX-3",
    name: "CogVideoX-3",
    family: "cogvideox",
    familyLabel: "Z.ai CogVideoX",
    tierLabel: "Best Value",
    tagline: "Up to 4K output with excellent text-instruction following — the most affordable way to draft and iterate.",
    strengths: ["Up to 4K resolution", "5s or 10s clips", "Great prompt accuracy"],
    costUsd: 0.2,
    durationSec: 10,
    resolution: "Up to 4K",
    imageMode: "any",
    textCapable: true,
    supportsAspectRatio: false,
    supportsStyle: false,
    isDefault: true,
  },
  {
    id: "viduq1-text",
    name: "ViduQ1 · Text",
    family: "viduq1",
    familyLabel: "Vidu Q1",
    tierLabel: "Cinematic 1080p",
    tagline: "Cinematic-grade 1080p clips straight from your written prompt. Superb for stylized and anime looks.",
    strengths: ["True 1080p clarity", "Anime & general styles", "Ultra-stable motion"],
    costUsd: 0.4,
    durationSec: 5,
    resolution: "1080p",
    imageMode: "none",
    textCapable: true,
    supportsAspectRatio: true,
    supportsStyle: true,
  },
  {
    id: "viduq1-image",
    name: "ViduQ1 · Image",
    family: "viduq1",
    familyLabel: "Vidu Q1",
    tierLabel: "Cinematic 1080p",
    tagline: "Turns a still frame or character image into an ultra-stable cinematic 1080p shot.",
    strengths: ["1080p image-to-video", "Smooth transitions", "High dynamism"],
    costUsd: 0.4,
    durationSec: 5,
    resolution: "1080p",
    imageMode: "single",
    textCapable: false,
    supportsAspectRatio: true,
    supportsStyle: false,
  },
  {
    id: "vidu2-image",
    name: "Vidu 2 · Image",
    family: "vidu2",
    familyLabel: "Vidu 2",
    tierLabel: "Fast & Efficient",
    tagline: "Z.ai's latest generation — fast, stable image-to-video at the lowest Vidu price. Great for batches.",
    strengths: ["Newest Vidu generation", "Fastest turnaround", "Stable color & motion"],
    costUsd: 0.2,
    durationSec: 4,
    resolution: "720p",
    imageMode: "single",
    textCapable: false,
    supportsAspectRatio: true,
    supportsStyle: false,
  },
  {
    id: "vidu2-reference",
    name: "Vidu 2 · Reference",
    family: "vidu2",
    familyLabel: "Vidu 2",
    tierLabel: "Character Consistency",
    tagline: "The character-consistency champion — anchors a character or product across every shot using reference images.",
    strengths: ["Multi-reference anchoring", "Same face across scenes", "Enhanced keyframes"],
    costUsd: 0.4,
    durationSec: 4,
    resolution: "720p",
    imageMode: "array",
    textCapable: false,
    supportsAspectRatio: true,
    supportsStyle: false,
  },
];

// ─── Lookup helpers ─────────────────────────────────────────────────────────

const MODEL_MAP = new Map<string, VideoModelInfo>(
  VIDEO_MODELS.map((m) => [m.id, m])
);

/** Info for a model id — null when unknown. */
export function getVideoModelInfo(id?: string | null): VideoModelInfo | null {
  if (!id) return null;
  return MODEL_MAP.get(id) ?? null;
}

/** Type guard for API/body validation. */
export function isValidVideoModelId(id: unknown): id is VideoModelId {
  return typeof id === "string" && MODEL_MAP.has(id);
}

/**
 * The model to actually use for a generation, given what the request has.
 *
 * Smart substitution keeps generation from dead-ending:
 *   • viduq1-image without an image  → viduq1-text   (same family, text mode)
 *   • vidu2-*      without an image  → CogVideoX-3   (vidu2 has no text mode)
 *   • viduq1-text  with an image     → viduq1-text   (image is simply dropped)
 */
export function resolveModelForRequest(
  modelId: string | null | undefined,
  hasImage: boolean
): VideoModelId {
  const model = getVideoModelInfo(modelId);
  if (!model) return DEFAULT_VIDEO_MODEL_ID;

  if (hasImage) {
    if (model.imageMode === "none") {
      // Text-only model: keep it (the transport layer drops the image).
      return model.id;
    }
    return model.id;
  }

  // No image available
  if (model.textCapable) return model.id;
  if (model.family === "viduq1") return "viduq1-text";
  return DEFAULT_VIDEO_MODEL_ID; // vidu2 family & unknowns
}

/**
 * Map the app's aspect ratio ("16:9" | "9:16" | "1:1" | "4:3" | "21:9") to a
 * Vidu-safe aspect_ratio value (Vidu supports the standard set; 21:9 collapses
 * to 16:9). Returns null for CogVideoX (which uses explicit sizes instead).
 */
export function viduAspectRatio(aspect: string | null | undefined): string | null {
  if (!aspect) return null;
  const supported = ["16:9", "9:16", "1:1", "4:3", "3:4"];
  return supported.includes(aspect) ? aspect : "16:9";
}

/**
 * Map a project style value to the ViduQ1-text `style` enum ("anime" for
 * animated/anime styles, "general" otherwise).
 */
export function viduStyle(style: string | null | undefined): "anime" | "general" {
  if (!style) return "general";
  return /anime|animation|cartoon|animated|manga/i.test(style) ? "anime" : "general";
}
