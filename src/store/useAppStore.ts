import { create } from "zustand";
import type { VideoProject, AppView } from "@/types/video";

interface AppState {
  currentView: AppView;
  projects: VideoProject[];
  currentProject: VideoProject | null;
  isGenerating: boolean;
  isEnhancing: boolean;
  isRecording: boolean;
  sidebarOpen: boolean;

  setCurrentView: (view: AppView) => void;
  setProjects: (projects: VideoProject[]) => void;
  setCurrentProject: (project: VideoProject | null) => void;
  setIsGenerating: (v: boolean) => void;
  setIsEnhancing: (v: boolean) => void;
  setIsRecording: (v: boolean) => void;
  setSidebarOpen: (v: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentView: "home",
  projects: [],
  currentProject: null,
  isGenerating: false,
  isEnhancing: false,
  isRecording: false,
  sidebarOpen: false,
  setCurrentView: (view) => set({ currentView: view }),
  setProjects: (projects) => set({ projects }),
  setCurrentProject: (project) => set({ currentProject: project }),
  setIsGenerating: (v) => set({ isGenerating: v }),
  setIsEnhancing: (v) => set({ isEnhancing: v }),
  setIsRecording: (v) => set({ isRecording: v }),
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
}));
