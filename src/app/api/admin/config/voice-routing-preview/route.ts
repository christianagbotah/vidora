import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { previewElevenLabsVoiceRoute } from "@/lib/elevenlabs-routing-admin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  try {
    const body = await req.json() as Record<string, unknown>;
    const preview = previewElevenLabsVoiceRoute({
      voiceMap: body.voiceMap,
      defaultVoiceId: body.defaultVoiceId,
      requestedVoice: body.requestedVoice,
      language: body.language,
      accent: body.accent,
    });

    return NextResponse.json({ success: true, preview });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to preview ElevenLabs voice routing",
      },
      { status: 400 },
    );
  }
}
