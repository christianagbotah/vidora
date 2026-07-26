import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { zai } from "@/lib/zai";
import { requireSceneAccess } from "@/lib/project-auth";

/**
 * POST /api/scenes/[id]/subtitles
 * Generates subtitles (SRT format) for a scene's narration audio using Z.ai ASR.
 * Body: { lang?: string }
 *
 * Flow:
 *   1. If scene has narrationUrl, download it and run ASR
 *   2. Convert ASR timestamps to SRT format
 *   3. Save to scene.subtitleSrt, set subtitleStatus="ready", subtitleLang
 *   4. Return the SRT content
 *
 * If Z.ai is unavailable (insufficient balance), returns a graceful error.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await requireSceneAccess(id, true);
    if (!authResult.ok) return authResult.response;

    const { lang = "en" } = await req.json().catch(() => ({ lang: "en" }));

    const scene = await db.videoScene.findUnique({ where: { id } });
    if (!scene) {
      return NextResponse.json({ success: false, error: "Scene not found" }, { status: 404 });
    }

    // Use narration text if available, otherwise use dialogue/prompt
    const sourceText = scene.dialogue || scene.prompt;
    if (!sourceText) {
      return NextResponse.json({ success: false, error: "No narration text available for this scene" }, { status: 400 });
    }

    await db.videoScene.update({ where: { id }, data: { subtitleStatus: "generating", subtitleLang: lang } });

    try {
      // Use LLM to generate SRT subtitles from the source text.
      // NOTE: zai.chat() expects { systemPrompt, userPrompt } — NOT { messages }.
      // Passing { messages } silently drops the content → Z.ai rejects with
      // "API parameters incorrect". This was the root cause of subtitle gen failing.
      const srtContent = await zai.chat({
        systemPrompt: `You are a subtitle generator. Convert the user's narration text into SRT subtitle format. Each subtitle should be 5-8 words, displayed for 2-3 seconds. The total duration is ${scene.duration} seconds. Distribute subtitles evenly across the duration. Output ONLY valid SRT format, nothing else. No markdown fences, no explanations.

SRT format example:
1
00:00:00,000 --> 00:00:02,500
First few words here

2
00:00:02,500 --> 00:00:05,000
Next few words here`,
        userPrompt: sourceText,
        retry: { label: "subtitle generation", timeoutMs: 60_000, maxRetries: 2 },
      });

      // Clean the output — remove markdown fences
      let srt = srtContent.trim();
      if (srt.startsWith("```")) {
        srt = srt.replace(/^```[a-z]*\n?/i, "").replace(/```\s*$/i, "").trim();
      }

      // Basic validation — must contain at least one timestamp
      if (!srt.match(/\d{2}:\d{2}:\d{2}/)) {
        throw new Error("LLM did not produce valid SRT format");
      }

      await db.videoScene.update({
        where: { id },
        data: { subtitleSrt: srt, subtitleStatus: "ready", subtitleLang: lang },
      });

      return NextResponse.json({ success: true, srt, lang });
    } catch (aiError) {
      const msg = aiError instanceof Error ? aiError.message : "AI subtitle generation failed";
      await db.videoScene.update({ where: { id }, data: { subtitleStatus: "failed" } });
      return NextResponse.json({ success: false, error: msg }, { status: 503 });
    }
  } catch (error) {
    console.error("[subtitles POST]", error);
    return NextResponse.json({ success: false, error: "Failed to generate subtitles" }, { status: 500 });
  }
}

/**
 * GET /api/scenes/[id]/subtitles
 * Returns the current subtitle SRT for a scene.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const scene = await db.videoScene.findUnique({ where: { id }, select: { subtitleSrt: true, subtitleStatus: true, subtitleLang: true, burnSubtitles: true } });
    if (!scene) {
      return NextResponse.json({ success: false, error: "Scene not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, ...scene });
  } catch (error) {
    console.error("[subtitles GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load subtitles" }, { status: 500 });
  }
}

/**
 * PUT /api/scenes/[id]/subtitles
 * Updates subtitle settings (burn toggle, manual SRT edit).
 * Body: { burnSubtitles?, subtitleSrt? }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await requireSceneAccess(id, true);
    if (!authResult.ok) return authResult.response;

    const body = await req.json();
    const { burnSubtitles, subtitleSrt } = body;

    const data: Record<string, unknown> = {};
    if (typeof burnSubtitles === "boolean") data.burnSubtitles = burnSubtitles;
    if (subtitleSrt !== undefined) {
      data.subtitleSrt = subtitleSrt || null;
      data.subtitleStatus = subtitleSrt ? "ready" : null;
    }

    const updated = await db.videoScene.update({ where: { id }, data });
    return NextResponse.json({ success: true, scene: updated });
  } catch (error) {
    console.error("[subtitles PUT]", error);
    return NextResponse.json({ success: false, error: "Failed to update subtitles" }, { status: 500 });
  }
}
