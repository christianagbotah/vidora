export const PHOTO_STUDIO_MAX_UPLOADS = 20;
export const PHOTO_STUDIO_MAX_PROJECT_ASSETS = 12;
export const PHOTO_STUDIO_MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export const PHOTO_STUDIO_ASPECTS = new Set(["16:9", "9:16", "1:1", "4:3", "21:9"]);
export const PHOTO_STUDIO_TRANSITIONS = new Set(["fade", "dissolve", "wipe", "slide", "cut"]);
export const PHOTO_STUDIO_MODES = new Set(["animate", "slideshow"]);

export type PhotoStudioMode = "animate" | "slideshow";

export type CharacterPerformanceProfile = {
  emotion: string;
  gestureIntensity: "low" | "medium" | "high";
  eyeContact: "camera" | "natural" | "off-camera";
  bodyMotion: "subtle" | "natural" | "expressive";
  actingStyle: string;
};

function text(value: unknown, max: number, fallback = ""): string {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

export function normalizeAssetIds(value: unknown, max = PHOTO_STUDIO_MAX_PROJECT_ASSETS): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean),
  )].slice(0, max);
}

export function sanitizePhotoStudioTitle(value: unknown): string {
  return text(value, 160, "My Photo Story") || "My Photo Story";
}

export function sanitizeAspectRatio(value: unknown): string {
  const candidate = text(value, 16, "16:9");
  return PHOTO_STUDIO_ASPECTS.has(candidate) ? candidate : "16:9";
}

export function sanitizeTransition(value: unknown): string {
  const candidate = text(value, 24, "fade");
  return PHOTO_STUDIO_TRANSITIONS.has(candidate) ? candidate : "fade";
}

export function sanitizeSecondsPerPhoto(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 6;
  return Math.max(3, Math.min(10, Math.round(parsed)));
}

export function sanitizePhotoStudioMode(value: unknown): PhotoStudioMode {
  const candidate = text(value, 24, "animate");
  return PHOTO_STUDIO_MODES.has(candidate) ? candidate as PhotoStudioMode : "animate";
}

export function sanitizePerformanceProfile(input: unknown): CharacterPerformanceProfile {
  const row = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const gesture = text(row.gestureIntensity, 16, "medium");
  const eye = text(row.eyeContact, 24, "camera");
  const body = text(row.bodyMotion, 24, "natural");
  return {
    emotion: text(row.emotion, 80, "natural") || "natural",
    gestureIntensity: gesture === "low" || gesture === "high" ? gesture : "medium",
    eyeContact: eye === "natural" || eye === "off-camera" ? eye : "camera",
    bodyMotion: body === "subtle" || body === "expressive" ? body : "natural",
    actingStyle: text(row.actingStyle, 120, "cinematic naturalism") || "cinematic naturalism",
  };
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

export function detectImageExtension(bytes: Uint8Array, declaredMime: string): string | null {
  const mime = declaredMime.toLowerCase();
  if (mime === "image/png" && startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "png";
  }
  if (mime === "image/jpeg" && startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return "jpg";
  }
  if (
    mime === "image/webp" &&
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

export function buildPhotoScenePrompt(
  mode: PhotoStudioMode,
  index: number,
  total: number,
  subjectName?: string | null,
): string {
  const subject = subjectName?.trim()
    ? ` Keep ${subjectName.trim()} visually identical to the supplied reference.`
    : "";
  if (mode === "slideshow") {
    return `Cinematic photo-story shot ${index + 1} of ${total}. Preserve the uploaded photograph faithfully. Add restrained parallax, natural depth, and a gentle documentary camera move without changing faces, clothing, readable text, architecture, products, or important objects.${subject}`;
  }
  return `Animate source photograph ${index + 1} of ${total} into a believable cinematic moment. Preserve identity and composition. Add subtle breathing, natural blinking and eye movement where a person is visible, realistic hair and clothing motion, environmental micro-motion, and restrained camera movement. Do not change age, face, body shape, wardrobe, product identity, readable text, or scene location.${subject}`;
}
