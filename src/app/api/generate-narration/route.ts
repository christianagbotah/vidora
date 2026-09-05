import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSceneAccess } from "@/lib/project-auth";
import { generateSceneNarration, TTS_VOICES } from "@/lib/narration";
import { zaiErrorResponse } from "@/lib/zai-errors";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let session: { userId: string; role: string; email: string } | null = null;

  try {
    const body = await req.json();
    const sceneId = typeof body.sceneId === "string" ? body.sceneId : "";
    if (!sceneId) {
      return NextResponse.json(
        { success: false, error: "Scene ID is required" },
        { status: 400 }
      );
    }

    const authResult = await requireSceneAccess(sceneId, true);
    if (!authResult.ok) return authResult.response;
    session = authResult.session;

    const scene = await db.videoScene.findUnique({ where: { id: sceneId } });
    if (!scene) {
      return NextResponse.json({ success: false, error: "Scene not found" }, { status: 404 });
    }
    if (body.projectId && String(body.projectId) !== scene.projectId) {
      return NextResponse.json(
        { success: false, error: "Scene does not belong to the supplied project" },
        { status: 400 }
      );
    }

    const narrationText =
      typeof body.text === "string" && body.text.trim()
        ? body.text.trim()
        : scene.dialogue?.trim() || "";
    if (!narrationText) {
      return NextResponse.json(
        { success: false, error: "No narration text provided and scene has no dialogue" },
        { status: 400 }
      );
    }
    if (narrationText.length > 12_000) {
      return NextResponse.json(
        { success: false, error: "Narration text is too long" },
        { status: 413 }
      );
    }

    // Omitting voice/speed now means "use the effective Voice Studio profile".
    // Explicit request values remain authoritative for one-off generation calls.
    const voice = typeof body.voice === "string" && body.voice.trim()
      ? body.voice.trim().toLowerCase()
      : undefined;
    const hasSpeed = body.speed !== undefined && body.speed !== null && body.speed !== "";
    const speed = hasSpeed ? Number(body.speed) : undefined;
    if (speed !== undefined && (!Number.isFinite(speed) || speed < 0.5 || speed > 2)) {
      return NextResponse.json(
        { success: false, error: "Invalid narration speed" },
        { status: 400 }
      );
    }

    // Billing, idempotency, provider invocation and persistence all live in
    // the shared narration helper. Keeping one authority prevents route-level
    // double charges and protects background callers such as export/auto-voice.
    const result = await generateSceneNarration({
      sceneId,
      text: narrationText,
      voice,
      speed,
    });

    return NextResponse.json({
      success: true,
      narrationUrl: result.url,
      text: narrationText,
      voice: voice || scene.narrationVoice || "auto",
      chunks: result.chunks,
      concatenated: result.concatenated,
      tokensCharged: result.tokensCharged,
      remainingTokens: result.remainingTokens,
      replayed: result.replayed ?? false,
    });
  } catch (error) {
    return zaiErrorResponse(error, {
      session,
      logLabel: "generate-narration",
    });
  }
}

export async function GET() {
  return NextResponse.json({ success: true, voices: TTS_VOICES });
}
