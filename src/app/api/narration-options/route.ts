import { NextResponse } from "next/server";
import {
  ALL_DUBBING_LANGUAGES,
  DUBBING_LANGUAGE_GROUPS,
} from "@/lib/dubbing-languages";
import {
  DEFAULT_NARRATION_PROFILE,
  NARRATION_ACCENTS,
  NARRATION_STYLES,
} from "@/lib/narration-profile";
import { TTS_VOICES } from "@/lib/narration";
import { getAIProviderSettings } from "@/lib/ai-provider-router";

export const runtime = "nodejs";

export async function GET() {
  const providerSettings = await getAIProviderSettings().catch(() => null);
  const provider = providerSettings?.ttsProvider || "zai";

  return NextResponse.json({
    success: true,
    defaults: {
      ...DEFAULT_NARRATION_PROFILE,
      voice: "tongtong",
    },
    languages: ALL_DUBBING_LANGUAGES,
    languageGroups: DUBBING_LANGUAGE_GROUPS,
    accents: NARRATION_ACCENTS,
    styles: NARRATION_STYLES,
    voices: TTS_VOICES,
    provider: {
      id: provider,
      structuredPerformanceControls: provider === "elevenlabs",
      languageBehavior:
        "The spoken language follows the narration/translation text. Choosing a language does not silently translate English text.",
      performanceBehavior:
        provider === "elevenlabs"
          ? "Accent and speaking style are applied as non-spoken performance direction when supported by ElevenLabs v3."
          : "Z.AI receives spoken text and the selected voice only; accent/style remain profile preferences until the provider supports structured performance controls.",
    },
  });
}
