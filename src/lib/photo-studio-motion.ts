export const PHOTO_MOTION_PRESETS = [
  {
    id: "natural",
    label: "Natural life",
    cameraMove: "static",
    instruction: "Preserve the source identity and composition exactly. Add only believable micro-movement: subtle breathing, blinking, tiny posture shifts, gentle hair or fabric motion, and restrained environmental movement. Keep the camera stable and avoid morphing.",
  },
  {
    id: "cinematic_push",
    label: "Cinematic push-in",
    cameraMove: "push-in",
    instruction: "Preserve the source identity and composition exactly. Use a slow cinematic push-in with subtle natural subject motion and shallow depth cues. Keep facial features, body proportions, wardrobe, text, logos, and background structure stable.",
  },
  {
    id: "parallax_depth",
    label: "Parallax depth",
    cameraMove: "parallax",
    instruction: "Preserve the source photograph faithfully while introducing restrained layered parallax between foreground, subject, and background. Use gentle depth movement only; do not redesign faces, objects, clothing, text, logos, or architecture.",
  },
  {
    id: "portrait_alive",
    label: "Portrait alive",
    cameraMove: "portrait",
    instruction: "Keep the person's identity, age, facial structure, body shape, hairstyle, wardrobe, and setting unchanged. Add subtle eye movement, natural blinking, a small head or shoulder shift, and calm breathing. Avoid exaggerated gestures or facial distortion.",
  },
  {
    id: "documentary",
    label: "Documentary drift",
    cameraMove: "handheld",
    instruction: "Preserve all source details. Add restrained documentary-style camera drift and realistic ambient movement with a grounded handheld feel. Motion must remain subtle enough that identity, geometry, text, and scene continuity stay intact.",
  },
  {
    id: "product_reveal",
    label: "Product reveal",
    cameraMove: "orbit",
    instruction: "Preserve the product geometry, branding, labels, text, colors, packaging, and proportions exactly. Add a gentle premium product-reveal movement with restrained depth and light motion. Do not invent surfaces, logos, words, components, or packaging.",
  },
  {
    id: "custom",
    label: "Custom direction",
    cameraMove: "custom",
    instruction: "",
  },
] as const;

export type PhotoMotionPresetId = (typeof PHOTO_MOTION_PRESETS)[number]["id"];

const MAX_CUSTOM_DIRECTION = 500;

export function sanitizePhotoMotionPreset(value: unknown): PhotoMotionPresetId {
  return PHOTO_MOTION_PRESETS.some((preset) => preset.id === value)
    ? value as PhotoMotionPresetId
    : "natural";
}

export function sanitizePhotoMotionCustomDirection(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_CUSTOM_DIRECTION);
}

export interface PhotoMotionDirection {
  preset: PhotoMotionPresetId;
  label: string;
  cameraMove: string;
  instruction: string;
}

export function resolvePhotoMotionDirection(
  presetValue: unknown,
  customDirectionValue?: unknown,
): PhotoMotionDirection {
  const preset = sanitizePhotoMotionPreset(presetValue);
  const presetConfig = PHOTO_MOTION_PRESETS.find((candidate) => candidate.id === preset)!;
  const customDirection = sanitizePhotoMotionCustomDirection(customDirectionValue);
  const instruction = preset === "custom"
    ? customDirection
    : presetConfig.instruction;

  if (!instruction) {
    throw new Error("Custom motion direction is required");
  }

  return {
    preset,
    label: presetConfig.label,
    cameraMove: presetConfig.cameraMove,
    instruction,
  };
}

export function buildDirectedPhotoPrompt(
  basePrompt: string,
  direction: PhotoMotionDirection,
): string {
  const normalizedBase = basePrompt.trim();
  return [
    normalizedBase,
    `Motion Director (${direction.label}): ${direction.instruction}`,
  ].filter(Boolean).join(" ");
}
