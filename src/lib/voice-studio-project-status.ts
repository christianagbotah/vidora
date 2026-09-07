export interface VoiceStudioProjectSaveResult {
  changed?: boolean;
  defaultsChanged?: boolean;
  changedSceneCount?: number;
}

export interface VoiceStudioProjectDefaultSource {
  narrationLang?: string | null;
  narrationAccent?: string | null;
  narrationStyle?: string | null;
  narrationVoice?: string | null;
}

export interface VoiceStudioComparableProfile {
  language: string;
  accent: string;
  style: string;
  voice: string;
}

export function voiceStudioProjectHasPersistedDefault(project: VoiceStudioProjectDefaultSource): boolean {
  return Boolean(
    project.narrationLang?.trim() &&
    project.narrationAccent?.trim() &&
    project.narrationStyle?.trim() &&
    project.narrationVoice?.trim(),
  );
}

export function voiceStudioProfilesEqual(
  left: VoiceStudioComparableProfile,
  right: VoiceStudioComparableProfile,
): boolean {
  return left.language === right.language &&
    left.accent === right.accent &&
    left.style === right.style &&
    left.voice === right.voice;
}

export function voiceStudioSceneProfileStatus(opts: {
  sceneProfile: VoiceStudioComparableProfile;
  projectProfile: VoiceStudioComparableProfile;
  hasPersistedProjectDefault: boolean;
}): {
  isOverride: boolean;
  label: string;
} {
  if (!opts.hasPersistedProjectDefault) {
    return { isOverride: false, label: "No saved project default" };
  }
  const isOverride = !voiceStudioProfilesEqual(opts.sceneProfile, opts.projectProfile);
  return {
    isOverride,
    label: isOverride ? "Scene override" : "Uses project default",
  };
}

export function voiceStudioProjectSaveMessage(result: VoiceStudioProjectSaveResult): string {
  const changedSceneCount = Number.isFinite(result.changedSceneCount)
    ? Math.max(0, Number(result.changedSceneCount))
    : 0;

  if (result.changed || changedSceneCount > 0) {
    return `Saved the whole-video narration default and updated ${changedSceneCount} current scene${changedSceneCount === 1 ? "" : "s"}. A fresh full-video preview is required before export.`;
  }

  if (result.defaultsChanged) {
    return "Saved this narration profile as the whole-video default for future scenes. Current scenes did not change, so the existing reviewed cut does not need a new preview.";
  }

  return "This whole-video narration default is already saved and all current scenes already match it.";
}

export function voiceStudioBulkProfileStatus(hasPersistedBulkProfile: boolean): {
  label: string;
  description: string;
} {
  return hasPersistedBulkProfile
    ? {
        label: "Saved project default",
        description: "New scenes inherit this profile automatically. Individual scenes can still override it below.",
      }
    : {
        label: "Not saved as project default",
        description: "This profile is currently inferred from existing scenes. Save it once to make future scenes inherit it automatically.",
      };
}
