import { AsyncLocalStorage } from "node:async_hooks";
import type { VoiceProfile } from "@/lib/voice-profile";

export interface VoiceSynthesisContext {
  sceneProfile: VoiceProfile;
  /** Profiles keyed by the logical voice ID the existing narration planner emits. */
  byVoice: Record<string, VoiceProfile>;
}

const voiceContext = new AsyncLocalStorage<VoiceSynthesisContext>();

export function runWithVoiceSynthesisContext<T>(
  context: VoiceSynthesisContext,
  fn: () => Promise<T>,
): Promise<T> {
  return voiceContext.run(context, fn);
}

export function getVoiceSynthesisContext(): VoiceSynthesisContext | undefined {
  return voiceContext.getStore();
}
