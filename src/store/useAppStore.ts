import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { VideoProject, AppView } from "@/types/video";

interface AppState {
  currentView: AppView;
  projects: VideoProject[];
  currentProject: VideoProject | null;
  isGenerating: boolean;
  isEnhancing: boolean;
  isRecording: boolean;
  sidebarOpen: boolean;
  /** Persisted project ID — survives reload so studio view can re-fetch the project */
  persistedProjectId: string | null;

  setCurrentView: (view: AppView) => void;
  setProjects: (projects: VideoProject[]) => void;
  setCurrentProject: (project: VideoProject | null) => void;
  setIsGenerating: (v: boolean) => void;
  setIsEnhancing: (v: boolean) => void;
  setIsRecording: (v: boolean) => void;
  setSidebarOpen: (v: boolean) => void;
  /** Clears persisted navigation state (e.g. on logout) */
  clearPersistedNav: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      currentView: "home",
      projects: [],
      currentProject: null,
      isGenerating: false,
      isEnhancing: false,
      isRecording: false,
      sidebarOpen: false,
      persistedProjectId: null,

      setCurrentView: (view) => set({ currentView: view }),
      setProjects: (projects) => set({ projects }),
      setCurrentProject: (project) =>
        set({ currentProject: project, persistedProjectId: project?.id ?? null }),
      setIsGenerating: (v) => set({ isGenerating: v }),
      setIsEnhancing: (v) => set({ isEnhancing: v }),
      setIsRecording: (v) => set({ isRecording: v }),
      setSidebarOpen: (v) => set({ sidebarOpen: v }),
      clearPersistedNav: () =>
        set({ currentView: "home", persistedProjectId: null, currentProject: null }),
    }),
    {
      name: "vidora-nav",
      /** Only persist view state and project ID — NOT transient flags */
      partialize: (state) => ({
        currentView: state.currentView,
        persistedProjectId: state.persistedProjectId,
      }),
    }
  )
);
