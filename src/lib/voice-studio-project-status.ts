export interface VoiceStudioProjectSaveResult {
  changed?: boolean;
  defaultsChanged?: boolean;
  changedSceneCount?: number;
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
