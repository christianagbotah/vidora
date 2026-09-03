import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { zaiErrorResponse } from "@/lib/zai-errors";
import { db } from "@/lib/db";
import { generateSceneNarration, TTS_VOICES } from "@/lib/narration";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { projectId, sceneId, text, voice = "tongtong", speed = 1.0 } = await req.json();

    if (!projectId || !sceneId) {
      return NextResponse.json({ success: false, error: "Project ID and Scene ID are required" }, { status: 400 });
    }

    // Determine the narration text
    let narrationText = text || "";

    if (!narrationText) {
      const scene = await db.videoScene.findUnique({ where: { id: sceneId } });
      if (!scene) {
        return NextResponse.json({ success: false, error: "Scene not found" }, { status: 404 });
      }
      if (!scene.dialogue) {
        return NextResponse.json({ success: false, error: "No narration text provided and scene has no dialogue" }, { status: 400 });
      }
      narrationText = scene.dialogue;
    }

    const result = await generateSceneNarration({ sceneId, text: narrationText, voice, speed });

    await db.videoScene.update({
      where: { id: sceneId },
      data: { narrationUrl: result.url, narrationVoice: voice },
    });

    console.log(`Narration generated for scene ${sceneId}: ${result.url} (${result.chunks} chunk(s), concatenated=${result.concatenated})`);

    return NextResponse.json({
      success: true,
      narrationUrl: result.url,
      text: narrationText,
      voice,
      chunks: result.chunks,
      concatenated: result.concatenated,
    });
  } catch (error) {
    console.error("Failed to generate narration:", error);
    const session = await getServerSession(authOptions).catch(() => null);
    return zaiErrorResponse(error, {
      session,
      logLabel: "generate-narration",
    });
  }
}

// GET handler to return available voices
export async function GET() {
  return NextResponse.json({ success: true, voices: TTS_VOICES });
}
