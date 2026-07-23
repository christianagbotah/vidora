export interface VideoScene {
  id: string;
  projectId: string;
  sceneNumber: number;
  prompt: string;
  enhancedPrompt?: string | null;
  imageUrl?: string | null;
  imageBase64?: string | null;
  videoUrl?: string | null;
  taskId?: string | null;
  duration: number;
  transition: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface VideoProject {
  id: string;
  title: string;
  description?: string | null;
  style: string;
  aspectRatio: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  scenes: VideoScene[];
}

export interface ClassicScene {
  id: string;
  title: string;
  description: string;
  prompt: string;
  image: string;
  category: string;
}

export type InputMode = "text" | "voice" | "video";
export type AppView = "home" | "create" | "studio" | "gallery";
