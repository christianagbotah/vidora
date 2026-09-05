export interface Character {
  id: string;
  projectId: string;
  name: string;
  role?: string | null;
  description?: string | null;
  stylePrompt?: string | null;
  voiceId?: string | null;
  imageUrl?: string | null;
  imageBase64?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SceneTranslation {
  id: string;
  sceneId: string;
  lang: string;
  langName: string;
  translatedText?: string | null;
  narrationUrl?: string | null;
  voiceId?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface VideoScene {
  id: string;
  projectId: string;
  sceneNumber: number;
  title?: string | null;
  prompt: string;
  enhancedPrompt?: string | null;
  visualNote?: string | null;
  dialogue?: string | null;
  characterIds?: string | null;
  referenceImageUrl?: string | null;
  narrationUrl?: string | null;
  narrationVoice?: string | null;
  mood?: string | null;
  cameraMove?: string | null;
  lighting?: string | null;
  musicMood?: string | null;
  musicTrackUrl?: string | null;
  musicVolume?: number;
  subtitleSrt?: string | null;
  subtitleStatus?: string | null;
  subtitleLang?: string | null;
  burnSubtitles?: boolean;
  narrationLang?: string | null;
  imageUrl?: string | null;
  imageBase64?: string | null;
  videoUrl?: string | null;
  taskId?: string | null;
  duration: number;
  transition: string;
  status: string;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
  translations?: SceneTranslation[];
}

export interface VideoProject {
  id: string;
  title: string;
  description?: string | null;
  style: string;
  aspectRatio: string;
  status: string;
  targetDuration: number;
  projectType?: string;
  /** Z.ai video model id (see src/lib/video-models.ts) — null = CogVideoX-3 default. */
  videoModel?: string | null;
  /** True when the project has a resumable Create-page server draft. */
  hasDraft?: boolean;
  draftData?: string | null;
  lastAutosavedAt?: string | null;
  finalVideoUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  scenes: VideoScene[];
  characters?: Character[];
}

export interface ClassicScene {
  id: string;
  title: string;
  description: string;
  prompt: string;
  image: string;
  category: string;
}

export interface ParsedSceneResult {
  prompt: string;
  title?: string | null;
  dialogue?: string | null;
  characterNames?: string[];
  visualNote?: string | null;
}

export interface DetectedCharacter {
  name: string;
  role: string;
  description: string | null;
  stylePrompt?: string | null;
}

export interface ContinuityIssue {
  type: "inconsistency" | "suggestion" | "warning";
  sceneIndex: number;
  description: string;
  fix: string;
  severity: "low" | "medium" | "high";
}

export type InputMode = "text" | "voice" | "video" | "script";
export type AppView = "home" | "create" | "studio" | "gallery" | "admin" | "buy-tokens" | "dashboard" | "profile";
