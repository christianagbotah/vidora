"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AudioLines, ChevronRight } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import {
  shouldShowVoiceStudioLauncher,
  voiceStudioProjectHref,
} from "@/lib/voice-studio-navigation";

export default function VoiceStudioLauncher() {
  const pathname = usePathname();
  const currentView = useAppStore((state) => state.currentView);
  const currentProjectId = useAppStore((state) => state.currentProject?.id ?? null);
  const persistedProjectId = useAppStore((state) => state.persistedProjectId);
  const projectId = currentProjectId || persistedProjectId;

  if (!shouldShowVoiceStudioLauncher({ pathname, currentView, projectId })) {
    return null;
  }

  return (
    <Link
      href={voiceStudioProjectHref(projectId)}
      className="group fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-4 z-40 inline-flex min-h-11 items-center gap-2 rounded-full border border-violet-200 bg-white/95 px-3.5 py-2.5 text-sm font-semibold text-violet-700 shadow-lg shadow-violet-950/10 backdrop-blur transition hover:-translate-y-0.5 hover:border-violet-300 hover:bg-violet-50 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 dark:border-violet-800 dark:bg-slate-950/95 dark:text-violet-300 dark:hover:border-violet-700 dark:hover:bg-violet-950/70 sm:bottom-6 sm:left-6"
      aria-label="Open Voice Studio for the current project"
      title="Open Voice Studio for this project"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white shadow-sm">
        <AudioLines className="h-4 w-4" />
      </span>
      <span className="whitespace-nowrap">Voice Studio</span>
      <ChevronRight className="h-4 w-4 text-violet-400 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
