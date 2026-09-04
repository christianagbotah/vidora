import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { zai } from "@/lib/zai";
import { requireSceneAccess } from "@/lib/project-auth";
import { zaiErrorResponse } from "@/lib/zai-errors";
import { deductTokensForOperation } from "@/lib/tokens";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { copyFile, unlink, writeFile } from "fs/promises";
import {
  DUBBING_LANGUAGES,
  DUBBING_LANGUAGE_GROUPS,
  getDubbingLanguage,
} from "@/lib/dubbing-languages";
import { writeAudioFile, deleteAudioFile, getAudioPath, ensureAudioDir } from "@/lib/audio-storage";

export const runtime = "nodejs";
const execFileAsync = promisify(execFile);

function splitTextIntoChunks(text: string, maxLen = 900): string[] {
  if (text.length <= maxLen) return [text];
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]+/g) || [text];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if ((current + sentence).length <= maxLen) {
      current += sentence;
    } else {
      if (current) chunks.push(current.trim());
      current = sentence;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text.slice(0, maxLen)];
}

async function concatAudioFiles(chunkPaths: string[], outputPath: string): Promise<boolean> {
  if (chunkPaths.length === 1) {
    try {
      await copyFile(chunkPaths[0], outputPath);
      return true;
    } catch (err) {
      console.error("[dubbing] single-chunk copy failed:", err);
      return false;
    }
  }

  const listFile = outputPath + ".concat.txt";
  const listContent = chunkPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  try {
    await writeFile(listFile, listContent, "utf8");
    await execFileAsync("ffmpeg", [
      "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outputPath,
    ], { timeout: 30_000 });
    return true;
  } catch (err) {
    console.error("[dubbing] ffmpeg concat failed:", err);
    return false;
  } finally {
    await unlink(listFile).catch(() => undefined);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await requireSceneAccess(id, true);
    if (!authResult.ok) return authResult.response;

    const { userId } = authResult.session;
    if (!userId || userId === "guest") {
      return NextResponse.json({ success: false, error: "Please sign in to generate dubbing" }, { status: 401 });
    }

    const { lang, voiceId } = await req.json();
    const langMeta = lang ? getDubbingLanguage(lang) : null;
    if (!langMeta) {
      return NextResponse.json(
        { success: false, error: `Unsupported language. Supported codes: ${Object.keys(DUBBING_LANGUAGES).join(", ")}` },
        { status: 400 }
      );
    }

    const scene = await db.videoScene.findUnique({ where: { id } });
    if (!scene) return NextResponse.json({ success: false, error: "Scene not found" }, { status: 404 });

    const sourceText = scene.dialogue || scene.prompt;
    if (!sourceText) {
      return NextResponse.json(
        { success: false, error: "No narration text to translate. Add dialogue to this scene first." },
        { status: 400 }
      );
    }

    const langName = langMeta.name;
    const voice = (voiceId || "tongtong").toLowerCase();
    let translation = await db.sceneTranslation.findUnique({ where: { sceneId_lang: { sceneId: id, lang } } });

    if (translation?.status === "ready" && translation.translatedText && translation.narrationUrl) {
      return NextResponse.json({ success: true, translation, message: "Translation already exists" });
    }

    if (!translation) {
      translation = await db.sceneTranslation.create({ data: { sceneId: id, lang, langName, status: "translating" } });
    } else {
      translation = await db.sceneTranslation.update({ where: { id: translation.id }, data: { status: "translating" } });
    }

    try {
      let cleanTranslation = translation.translatedText?.trim() || "";
      if (!cleanTranslation) {
        const translationCharge = await deductTokensForOperation({
          userId,
          operation: "llm",
          description: `Dubbing translation (${langName}) for scene ${scene.sceneNumber}`,
          referenceId: translation.id,
          idempotencyKey: `dubbing:${translation.id}:translate`,
        });
        if (!translationCharge.success) {
          await db.sceneTranslation.update({ where: { id: translation.id }, data: { status: "failed" } }).catch(() => undefined);
          return NextResponse.json(
            { success: false, error: translationCharge.error || "Insufficient tokens for translation" },
            { status: 402 }
          );
        }

        const translatedText = await zai.chat({
          systemPrompt: `You are a professional dubbing translator. Translate the user's narration text into ${langName}. Preserve the original tone, emotion, pacing, and any character voice. Output ONLY the translated text — no explanations, no quotation marks, no notes, no preamble.`,
          userPrompt: sourceText,
          retry: { label: `translate to ${lang}`, timeoutMs: 30_000, maxRetries: 2 },
        });

        cleanTranslation = translatedText.replace(/^["'“”]+|["'“”]+$/g, "").trim();
        if (!cleanTranslation) throw new Error("Translation came back empty");
        translation = await db.sceneTranslation.update({
          where: { id: translation.id },
          data: { translatedText: cleanTranslation, status: "generating" },
        });
      } else {
        translation = await db.sceneTranslation.update({
          where: { id: translation.id },
          data: { status: "generating" },
        });
      }

      const chunks = splitTextIntoChunks(cleanTranslation);
      ensureAudioDir();
      const chunkPaths: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const ttsCharge = await deductTokensForOperation({
          userId,
          operation: "tts",
          description: `Dubbing voice (${langName}) chunk ${i + 1}/${chunks.length} for scene ${scene.sceneNumber}`,
          referenceId: translation.id,
          idempotencyKey: `dubbing:${translation.id}:tts:${i}`,
        });
        if (!ttsCharge.success) {
          await db.sceneTranslation.update({ where: { id: translation.id }, data: { status: "failed" } }).catch(() => undefined);
          return NextResponse.json(
            { success: false, error: ttsCharge.error || "Insufficient tokens for dubbing voice generation" },
            { status: 402 }
          );
        }

        const arrayBuffer = await zai.tts({
          input: chunks[i],
          voice,
          retry: { label: `tts ${lang} chunk ${i + 1}/${chunks.length}`, timeoutMs: 120_000, maxRetries: 4 },
        });
        const buffer = Buffer.from(new Uint8Array(arrayBuffer));
        const chunkFilename = `dub_${id}_${lang}_${i}_${Date.now()}.wav`;
        chunkPaths.push(writeAudioFile(chunkFilename, buffer));
      }

      const finalFilename = `dub_${id}_${lang}_${Date.now()}.wav`;
      const finalPath = getAudioPath(finalFilename);
      const concatenated = await concatAudioFiles(chunkPaths, finalPath);
      let narrationUrl: string;
      if (concatenated) {
        narrationUrl = `/api/audio/${finalFilename}`;
        for (const p of chunkPaths) deleteAudioFile(path.basename(p));
      } else {
        narrationUrl = `/api/audio/${path.basename(chunkPaths[0])}`;
      }

      const updated = await db.sceneTranslation.update({
        where: { id: translation.id },
        data: { narrationUrl, voiceId: voice, status: "ready" },
      });
      return NextResponse.json({ success: true, translation: updated, chunks: chunks.length });
    } catch (aiError) {
      await db.sceneTranslation.update({ where: { id: translation.id }, data: { status: "failed" } }).catch(() => {});
      return zaiErrorResponse(aiError, { session: authResult.session, logLabel: "dubbing" });
    }
  } catch (error) {
    console.error("[dubbing POST]", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ success: false, error: "Failed to generate dubbing" }, { status: 500 });
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await requireSceneAccess(id, false);
    if (!authResult.ok) return authResult.response;

    const translations = await db.sceneTranslation.findMany({
      where: { sceneId: id },
      orderBy: { lang: "asc" },
    });
    return NextResponse.json({
      success: true,
      translations,
      supportedLangs: DUBBING_LANGUAGES,
      languageGroups: DUBBING_LANGUAGE_GROUPS,
    });
  } catch (error) {
    console.error("[dubbing GET]", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ success: false, error: "Failed to load translations" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await requireSceneAccess(id, true);
    if (!authResult.ok) return authResult.response;

    const lang = new URL(req.url).searchParams.get("lang");
    if (!lang || !getDubbingLanguage(lang)) {
      return NextResponse.json({ success: false, error: "A valid `lang` query parameter is required" }, { status: 400 });
    }

    const translation = await db.sceneTranslation.findUnique({ where: { sceneId_lang: { sceneId: id, lang } } });
    if (!translation) return NextResponse.json({ success: false, error: "Translation not found" }, { status: 404 });

    if (translation.narrationUrl) {
      const filename = translation.narrationUrl.split("/").pop();
      if (filename) {
        try { deleteAudioFile(filename); } catch { /* non-fatal */ }
      }
    }
    await db.sceneTranslation.delete({ where: { id: translation.id } });
    return NextResponse.json({ success: true, message: "Translation deleted" });
  } catch (error) {
    console.error("[dubbing DELETE]", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ success: false, error: "Failed to delete translation" }, { status: 500 });
  }
}
