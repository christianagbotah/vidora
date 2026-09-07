export function voiceStudioProjectHref(projectId?: string | null): string {
  const normalized = typeof projectId === "string" ? projectId.trim() : "";
  return normalized
    ? `/voice-studio/${encodeURIComponent(normalized)}`
    : "/voice-studio";
}

export function shouldShowVoiceStudioLauncher(opts: {
  pathname: string;
  currentView: string;
  projectId?: string | null;
}): boolean {
  return opts.pathname === "/" && opts.currentView === "studio" && Boolean(opts.projectId?.trim());
}
