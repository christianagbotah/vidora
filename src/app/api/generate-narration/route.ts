import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSceneAccess } from "@/lib/project-auth";
import { generateSceneNarration, TTS_VOICES } from "@/lib/narration";
import { zaiErrorResponse } from "@/lib/zai-errors";
import { getDubbingLanguage } from "@/lib/dubbing-languages";
import {
  NARRATION_ACCENTS,
  NARRATION_STYLES,
  normalizeNarrationProfile,
} from "@/lib/narration-profile";

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

    const requestedLanguage =
      typeof body.language === "string"
        ? body.language
        : scene.narrationLang || "en";
    const profile = normalizeNarrationProfile({
      language: requestedLanguage,
      accent: typeof body.accent === "string" ? body.accent : undefined,
      style: typeof body.style === "string" ? body.style : undefined,
    });
    const languageMeta = getDubbingLanguage(profile.language);
    if (!languageMeta) {
      return NextResponse.json(
        { success: false, error: "Unsupported narration language" },
        { status: 400 }
      );
    }

    const explicitText = typeof body.text === "string" && body.text.trim()
      ? body.text.trim()
      : "";

    let narrationText = explicitText;
    if (!narrationText && profile.language !== "en") {
      const translation = await db.sceneTranslation.findUnique({
        where: { sceneId_lang: { sceneId, lang: profile.language } },
        select: { translatedText: true, status: true },
      });
      narrationText = translation?.translatedText?.trim() || "";
      if (!narrationText) {
        return NextResponse.json(
          {
            success: false,
            error: `No ${languageMeta.name} translation exists for this scene yet. Generate the translation/dubbing first or provide translated narration text.`,
            code: "TRANSLATION_REQUIRED",
            language: profile.language,
          },
          { status: 409 }
        );
      }
    }

    if (!narrationText) {
      narrationText = scene.dialogue?.trim() || "";
    }
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

    const voice = typeof body.voice === "string" ? body.voice.toLowerCase() : "tongtong";
    const speed = Number(body.speed ?? 1);
    if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) {
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
      language: profile.language,
      accent: profile.accent,
      style: profile.style,
    });

    return NextResponse.json({
      success: true,
      narrationUrl: result.url,
      text: narrationText,
      voice,
      language: result.profile.language,
      languageName: languageMeta.name,
      accent: result.profile.accent,
      style: result.profile.style,
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
  return NextResponse.json({
    success: true,
    voices: TTS_VOICES,
    accents: NARRATION_ACCENTS,
    styles: NARRATION_STYLES,
  });
}
