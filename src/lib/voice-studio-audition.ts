export interface VoiceStudioAuditionProfile {
  language: string;
  accent: string;
  style: string;
  voice: string;
}

export function buildVoiceStudioNarrationRequest(opts: {
  projectId: string;
  sceneId: string;
  profile: VoiceStudioAuditionProfile;
}) {
  return {
    projectId: opts.projectId,
    sceneId: opts.sceneId,
    voice: opts.profile.voice,
    language: opts.profile.language,
    accent: opts.profile.accent,
    style: opts.profile.style,
  };
}

export function voiceStudioNarrationSuccessMessage(result: {
  replayed?: boolean;
  tokensCharged?: number;
  languageName?: string;
}): string {
  const language = result.languageName ? ` in ${result.languageName}` : "";
  if (result.replayed) {
    return `Narration${language} is ready to audition. Vidora reused the existing matching performance without a new token charge.`;
  }
  const charged = Number(result.tokensCharged) || 0;
  return charged > 0
    ? `Narration${language} is ready to audition. ${charged} narration token${charged === 1 ? " was" : "s were"} used.`
    : `Narration${language} is ready to audition.`;
}
