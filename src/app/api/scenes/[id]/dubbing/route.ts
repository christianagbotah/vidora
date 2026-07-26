import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { zai } from "@/lib/zai";
import { requireSceneAccess } from "@/lib/project-auth";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

/**
 * POST /api/scenes/[id]/dubbing
 * Generates a dubbed narration for a scene in a target language.
 * Body: { lang: string, langName?: string, voiceId?: string }
 *
 * Flow:
 *   1. Translate the scene's dialogue/narration text via LLM
 *   2. Generate TTS audio in the target language
 *   3. Save as a SceneTranslation record
 *   4. Return the translation + audio URL
 *
 * If Z.ai is unavailable, returns a graceful error.
 */

const SUPPORTED_LANGS: Record<string, string> = {
  en: "English", fr: "French", twi: "Twi (Akan)", ga: "Ga", ha: "Hausa",
  es: "Spanish", pt: "Portuguese", ar: "Arabic", zh: "Chinese (Mandarin)",
  de: "German", sw: "Swahili", yo: "Yoruba",
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await requireSceneAccess(id, true);
    if (!authResult.ok) return authResult.response;

    const { lang, voiceId } = await req.json();
    if (!lang || !SUPPORTED_LANGS[lang]) {
      return NextResponse.json({ success: false, error: `Unsupported language. Supported: ${Object.keys(SUPPORTED_LANGS).join(", ")}` }, { status: 400 });
    }

    const scene = await db.videoScene.findUnique({ where: { id } });
    if (!scene) {
      return NextResponse.json({ success: false, error: "Scene not found" }, { status: 404 });
    }

    const sourceText = scene.dialogue || scene.prompt;
    if (!sourceText) {
      return NextResponse.json({ success: false, error: "No narration text to translate" }, { status: 400 });
    }

    const langName = SUPPORTED_LANGS[lang];

    // Create or update the translation record
    let translation = await db.sceneTranslation.findUnique({
      where: { sceneId_lang: { sceneId: id, lang } },
    });

    if (translation && translation.status === "ready" && translation.translatedText) {
      return NextResponse.json({ success: true, translation, message: "Translation already exists" });
    }

    if (!translation) {
      translation = await db.sceneTranslation.create({
        data: { sceneId: id, lang, langName, status: "translating" },
      });
    } else {
      translation = await db.sceneTranslation.update({
        where: { id: translation.id },
        data: { status: "translating" },
      });
    }

    try {
      // Step 1: Translate via LLM
      const translatePrompt = `Translate the following text into ${langName}. Keep the tone and emotion. Output ONLY the translated text, nothing else.

Text: "${sourceText}"`;

      const translatedText = await zai.chat({
        messages: [{ role: "user", content: translatePrompt }],
        retry: { label: `translate to ${lang}`, timeoutMs: 30_000, maxRetries: 2 },
      });

      const cleanTranslation = translatedText.replace(/^["']|["']$/g, "").trim();

      await db.sceneTranslation.update({
        where: { id: translation.id },
        data: { translatedText: cleanTranslation, status: "generating" },
      });

      // Step 2: Generate TTS audio
      const audioBase64 = await zai.tts({
        text: cleanTranslation,
        voice: voiceId || "TongTong",
        retry: { label: `tts ${lang}`, timeoutMs: 60_000, maxRetries: 2 },
      });

      // Save audio to public/generated
      const audioBuffer = Buffer.from(audioBase64, "base64");
      const filename = `dub_${id}_${lang}_${Date.now()}.mp3`;
      const outputDir = path.join(process.cwd(), "public", "generated");
      await mkdir(outputDir, { recursive: true });
      await writeFile(path.join(outputDir, filename), audioBuffer);
      const narrationUrl = `/generated/${filename}`;

      const updated = await db.sceneTranslation.update({
        where: { id: translation.id },
        data: { narrationUrl, voiceId: voiceId || "TongTong", status: "ready" },
      });

      return NextResponse.json({ success: true, translation: updated });
    } catch (aiError) {
      const msg = aiError instanceof Error ? aiError.message : "AI dubbing failed";
      await db.sceneTranslation.update({
        where: { id: translation.id },
        data: { status: "failed" },
      }).catch(() => {});
      return NextResponse.json({ success: false, error: msg }, { status: 503 });
    }
  } catch (error) {
    console.error("[dubbing POST]", error);
    return NextResponse.json({ success: false, error: "Failed to generate dubbing" }, { status: 500 });
  }
}

/**
 * GET /api/scenes/[id]/dubbing
 * Returns all translations for a scene.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const translations = await db.sceneTranslation.findMany({
      where: { sceneId: id },
      orderBy: { lang: "asc" },
    });
    return NextResponse.json({ success: true, translations, supportedLangs: SUPPORTED_LANGS });
  } catch (error) {
    console.error("[dubbing GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load translations" }, { status: 500 });
  }
}
