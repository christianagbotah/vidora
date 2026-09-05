import type { DetectedCharacter, InputMode, ParsedSceneResult } from "@/types/video";

export const CREATE_DRAFT_VERSION = 1 as const;

export type CreateDraftSaveStatus = "idle" | "saving" | "saved" | "error";

export interface CreateDraftSnapshot {
  version: typeof CREATE_DRAFT_VERSION;
  inputMode: InputMode;
  scriptText: string;
  textPrompt: string;
  enhancedText: string;
  selectedStyle: string;
  selectedAspect: string;
  selectedModel: string;
  selectedDuration: number;
  customDuration: string;
  isCustomDuration: boolean;
  projectType: string;
  createStep: number;
  parsedScenes: ParsedSceneResult[];
  parsedCharacters: DetectedCharacter[];
  parsedCelebration: string | null;
  parsedDefaultMusic: { mood: string; url: string } | null;
  preCharImages: Record<string, string>;
  previewStoryboard: Record<string, unknown> | null;
  previewImageUrl: string | null;
  previewImageError: string | null;
  savedAt?: string;
}

export interface CreateDraftSaveResponse {
  success: boolean;
  projectId?: string;
  created?: boolean;
  autosavedAt?: string;
  snapshot?: CreateDraftSnapshot;
  error?: string;
}
