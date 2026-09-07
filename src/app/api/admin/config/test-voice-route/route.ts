import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getAIProviderSettings, synthesizeProviderSpeech } from "@/lib/ai-provider-router";

export const runtime = "nodejs";

function safeText(value: unknown, fallback: string, maxLength = 80): string {
  if (typeof value !== "string") return fallback;
  const clean = value.trim();
  return clean ? clean.slice(0, maxLength) : fallback;
}

export async function POST(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  try {
    const body = await req.json() as Record<string, unknown>;
    const settings = await getAIProviderSettings();
    if (settings.ttsProvider !== "elevenlabs") {
      return NextResponse.json(
        {
          success: false,
          error: "ElevenLabs must be the active TTS provider before testing an ElevenLabs routing profile.",
        },
        { status: 400 },
      );
    }

    const requestedVoice = safeText(body.requestedVoice, "tongtong", 64);
    const language = safeText(body.language, "en", 24).toLowerCase();
    const accent = safeText(body.accent, "auto", 48).toLowerCase();
    const probeText = safeText(body.text, "Vidora voice routing test.", 180);
    const started = Date.now();
    const result = await synthesizeProviderSpeech({
      input: probeText,
      voice: requestedVoice,
      language,
      accent,
      speed: 1,
    });

    return NextResponse.json({
      success: true,
      message: "Saved ElevenLabs route produced audio successfully",
      provider: result.provider,
      model: result.model,
      resolvedVoice: result.voice,
      requestedVoice: requestedVoice.toLowerCase(),
      language,
      accent,
      audioBytes: result.buffer.length,
      latencyMs: Date.now() - started,
      billingNote: "No Vidora user tokens were deducted. The configured TTS provider may bill this short probe according to its own account plan.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Voice route test failed",
      },
      { status: 502 },
    );
  }
}
