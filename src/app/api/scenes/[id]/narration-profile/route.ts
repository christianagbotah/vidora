import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSceneAccess } from "@/lib/project-auth";
import { getDubbingLanguage } from "@/lib/dubbing-languages";
import { normalizeNarrationProfile } from "@/lib/narration-profile";

export const runtime = "nodejs";

const VOICE_RE = /^[a-zA-Z0-9_-]{1,80}$/;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sceneId } = await params;
  const authResult = await requireSceneAccess(sceneId, true);
  if (!authResult.ok) return authResult.response;

  try {
    const body = await req.json();
    const scene = await db.videoScene.findUnique({
      where: { id: sceneId },
      select: {
        id: true,
        narrationLang: true,
        narrationAccent: true,
        narrationStyle: true,
        narrationVoice: true,
      },
    });
    if (!scene) {
      return NextResponse.json({ success: false, error: "Scene not found" }, { status: 404 });
    }

    const profile = normalizeNarrationProfile({
      language:
        typeof body.language === "string"
          ? body.language
          : scene.narrationLang || "en",
      accent:
        typeof body.accent === "string"
          ? body.accent
          : scene.narrationAccent || "auto",
      style:
        typeof body.style === "string"
          ? body.style
          : scene.narrationStyle || "natural",
    });

    if (!getDubbingLanguage(profile.language)) {
      return NextResponse.json(
        { success: false, error: "Unsupported narration language" },
        { status: 400 },
      );
    }

    const voice =
      typeof body.voice === "string"
        ? body.voice.trim().toLowerCase()
        : scene.narrationVoice || "tongtong";
    if (!VOICE_RE.test(voice)) {
      return NextResponse.json(
        { success: false, error: "Invalid narration voice" },
        { status: 400 },
      );
    }

    const changed =
      (scene.narrationLang || "en") !== profile.language ||
      (scene.narrationAccent || "auto") !== profile.accent ||
      (scene.narrationStyle || "natural") !== profile.style ||
      (scene.narrationVoice || "tongtong") !== voice;

    const updated = await db.videoScene.update({
      where: { id: sceneId },
      data: {
        narrationLang: profile.language,
        narrationAccent: profile.accent,
        narrationStyle: profile.style,
        narrationVoice: voice,
        ...(changed ? { narrationUrl: null } : {}),
      },
      select: {
        id: true,
        narrationLang: true,
        narrationAccent: true,
        narrationStyle: true,
        narrationVoice: true,
        narrationUrl: true,
      },
    });

    return NextResponse.json({
      success: true,
      changed,
      profile: {
        language: updated.narrationLang || "en",
        accent: updated.narrationAccent || "auto",
        style: updated.narrationStyle || "natural",
        voice: updated.narrationVoice || "tongtong",
      },
      narrationInvalidated: changed && !updated.narrationUrl,
    });
  } catch (error) {
    console.error("Save narration profile error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to save narration profile" },
      { status: 500 },
    );
  }
}
