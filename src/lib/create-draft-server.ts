import crypto from "crypto";
import { saveGeneratedFile } from "@/lib/generated-store";
import {
  CREATE_DRAFT_VERSION,
  type CreateDraftSnapshot,
} from "@/lib/create-draft-types";
import type { DetectedCharacter, InputMode, ParsedSceneResult } from "@/types/video";

const MAX_SCRIPT_CHARS = 500_000;
const MAX_TEXT_CHARS = 500_000;
const MAX_DRAFT_JSON_BYTES = 2_000_000;
const MAX_PREVIEW_JSON_BYTES = 500_000;
const MAX_CHARACTER_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_CHARACTERS = 60;
const MAX_SCENES = 120;

const INPUT_MODES = new Set<InputMode>(["text", "voice", "video", "script"]);
const IMAGE_MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

function safeString(value: unknown, max: number, fallback = ""): string {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

function safeNullableString(value: unknown, max: number): string | null {
  return typeof value === "string" && value ? value.slice(0, max) : null;
}

function safeInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function sanitizeParsedScenes(value: unknown): ParsedSceneResult[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_SCENES).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const prompt = safeString(row.prompt, 50_000).trim();
    if (!prompt) return [];
    const names = Array.isArray(row.characterNames)
      ? row.characterNames
          .filter((name): name is string => typeof name === "string")
          .map((name) => name.trim().slice(0, 160))
          .filter(Boolean)
          .slice(0, MAX_CHARACTERS)
      : undefined;
    return [{
      prompt,
      title: safeNullableString(row.title, 500),
      dialogue: safeNullableString(row.dialogue, 50_000),
      visualNote: safeNullableString(row.visualNote, 50_000),
      ...(names?.length ? { characterNames: names } : {}),
    }];
  });
}

function sanitizeParsedCharacters(value: unknown): DetectedCharacter[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: DetectedCharacter[] = [];
  for (const item of value.slice(0, MAX_CHARACTERS)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = safeString(row.name, 160).trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      name,
      role: safeString(row.role, 80, "supporting") || "supporting",
      description: safeNullableString(row.description, 20_000),
      stylePrompt: safeNullableString(row.stylePrompt, 20_000),
    });
  }
  return result;
}

function sanitizePreviewStoryboard(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, "utf8") > MAX_PREVIEW_JSON_BYTES) return null;
    return JSON.parse(serialized) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function sanitizeImageMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(value as Record<string, unknown>).slice(0, MAX_CHARACTERS)) {
    const name = rawName.trim().slice(0, 160);
    if (!name || typeof rawValue !== "string") continue;
    // Data URLs are temporarily allowed here and are moved to generated-store
    // before draftData is written. Existing generated-store URLs are retained.
    if (rawValue.startsWith("data:image/") || rawValue.startsWith("/generated/")) {
      result[name] = rawValue;
    }
  }
  return result;
}

export function sanitizeCreateDraftSnapshot(input: unknown): CreateDraftSnapshot {
  const row = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const inputMode = INPUT_MODES.has(row.inputMode as InputMode)
    ? row.inputMode as InputMode
    : "text";

  const musicRaw = row.parsedDefaultMusic;
  const parsedDefaultMusic = musicRaw && typeof musicRaw === "object" && !Array.isArray(musicRaw)
    ? {
        mood: safeString((musicRaw as Record<string, unknown>).mood, 120),
        url: safeString((musicRaw as Record<string, unknown>).url, 5_000),
      }
    : null;

  const snapshot: CreateDraftSnapshot = {
    version: CREATE_DRAFT_VERSION,
    inputMode,
    scriptText: safeString(row.scriptText, MAX_SCRIPT_CHARS),
    textPrompt: safeString(row.textPrompt, MAX_TEXT_CHARS),
    enhancedText: safeString(row.enhancedText, MAX_TEXT_CHARS),
    selectedStyle: safeString(row.selectedStyle, 120, "cinematic") || "cinematic",
    selectedAspect: safeString(row.selectedAspect, 32, "16:9") || "16:9",
    selectedModel: safeString(row.selectedModel, 160),
    selectedDuration: safeInt(row.selectedDuration, 10, 300, 60),
    customDuration: safeString(row.customDuration, 16),
    isCustomDuration: row.isCustomDuration === true,
    projectType: safeString(row.projectType, 120, "custom") || "custom",
    createStep: safeInt(row.createStep, 0, 2, 0),
    parsedScenes: sanitizeParsedScenes(row.parsedScenes),
    parsedCharacters: sanitizeParsedCharacters(row.parsedCharacters),
    parsedCelebration: safeNullableString(row.parsedCelebration, 10_000),
    parsedDefaultMusic: parsedDefaultMusic?.url ? parsedDefaultMusic : null,
    preCharImages: sanitizeImageMap(row.preCharImages),
    previewStoryboard: sanitizePreviewStoryboard(row.previewStoryboard),
    previewImageUrl: safeNullableString(row.previewImageUrl, 5_000),
    previewImageError: safeNullableString(row.previewImageError, 2_000),
    savedAt: new Date().toISOString(),
  };

  return snapshot;
}

function decodeCharacterImage(dataUrl: string): { buffer: Buffer; ext: string } | null {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const ext = IMAGE_MIME_EXT[mime];
  if (!ext) return null;
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!buffer.length || buffer.length > MAX_CHARACTER_IMAGE_BYTES) return null;
  return { buffer, ext };
}

export async function persistDraftCharacterImages(
  projectId: string,
  snapshot: CreateDraftSnapshot,
): Promise<CreateDraftSnapshot> {
  const persisted: Record<string, string> = {};
  for (const [name, value] of Object.entries(snapshot.preCharImages)) {
    if (value.startsWith("/generated/")) {
      persisted[name] = value;
      continue;
    }
    const decoded = decodeCharacterImage(value);
    if (!decoded) continue;
    const digest = crypto.createHash("sha256").update(decoded.buffer).digest("hex").slice(0, 24);
    const url = await saveGeneratedFile(
      `drafts/${projectId}/characters/${digest}.${decoded.ext}`,
      decoded.buffer,
    );
    persisted[name] = url;
  }

  const clean = { ...snapshot, preCharImages: persisted, savedAt: new Date().toISOString() };
  const serialized = JSON.stringify(clean);
  if (Buffer.byteLength(serialized, "utf8") > MAX_DRAFT_JSON_BYTES) {
    throw new Error("Draft is too large to autosave. Shorten the script or storyboard and try again.");
  }
  return clean;
}

export function createDraftDescription(snapshot: CreateDraftSnapshot): string | null {
  const text = snapshot.inputMode === "script"
    ? snapshot.scriptText
    : (snapshot.enhancedText || snapshot.textPrompt || snapshot.scriptText);
  const trimmed = text.trim();
  return trimmed ? trimmed.slice(0, 200) : null;
}

export function normalizedCharacterName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

export const DRAFT_CHARACTER_VOICES = [
  "chuichui",
  "luodo",
  "kazi",
  "douji",
  "xiaochen",
  "jam",
  "tongtong",
] as const;
