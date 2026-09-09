import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { zai } from "@/lib/zai";
import { requireSceneAccess } from "@/lib/project-auth";
import { zaiErrorResponse } from "@/lib/zai-errors";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { unlink, writeFile } from "fs/promises";
import {
  DUBBING_LANGUAGES,
  DUBBING_LANGUAGE_GROUPS,
  getDubbingLanguage,
} from "@/lib/dubbing-languages";
import { writeAudioFile, deleteAudioFile, getAudioPath, ensureAudioDir } from "@/lib/audio-storage";
import {
  captureMeteredZaiTextOperation,
  reserveMeteredZaiTextOperation,
} from "@/lib/zai-metered-billing";
import {
  captureImmediateProviderOperation,
  reserveImmediateProviderOperation,
} from "@/lib/immediate-provider-billing";
import { BillingSafetyError } from "@/lib/provider-cost-billing";
import { getAIProviderSettings } from "@/lib/ai-provider-router-qwen";
import {
  resolveQwenTtsModel,
  splitQwenTtsInput,
  synthesizeQwenTts,
} from "@/lib/qwen-tts";

export const runtime = "nodejs";
const execFileAsync = promisify(execFile);

async function concatAudioFiles(chunkPaths: string[], outputPath: string): Promise<boolean> {
  if (chunkPaths.length === 0) return false;

  const listFile = outputPath + ".concat.txt";
  const listContent = chunkPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  try {
    await writeFile(listFile, listContent, "utf8");
    // Always normalize the final dubbing asset to PCM WAV. Qwen may return
    // either MP3 or WAV, and copying a single MP3 into a .wav path would create
    // a mislabeled media file. Transcoding also makes mixed chunk formats safe.
    await execFileAsync("ffmpeg", [
      "-nostdin", "-y", "-f", "concat", "-safe", "0", "-i", listFile,
      "-vn", "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", outputPath,
    ], { timeout: 60_000 });
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

    const { lang, voiceId, translateOnly } = await req.json();
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
      let tokensCharged = 0;
      let cleanTranslation = translation.translatedText?.trim() || "";
      if (!cleanTranslation) {
        const systemPrompt = `You are a professional dubbing translator. Translate the user's narration text into ${langName}. Preserve the original tone, emotion, pacing, and any character voice. Output ONLY the translated text — no explanations, no quotation marks, no notes, no preamble.`;
        const lineKeyPrefix = `dubbing:${translation.id}:translate`;
        const translationBilling = await reserveMeteredZaiTextOperation({
          userId,
          projectId: scene.projectId,
          sceneId: id,
          referenceId: translation.id,
          idempotencyKey: `${lineKeyPrefix}:reservation`,
          lineKeyPrefix,
          label: `Dubbing translation (${langName}) for scene ${scene.sceneNumber}`,
          systemPrompt,
          userPrompt: sourceText,
          maxOutputTokens: 4_000,
          requireConfiguredPrimary: false,
        });
        const captures = await captureMeteredZaiTextOperation({
          reservationId: translationBilling.reservation.id,
          lineKeyPrefix,
          userId,
          projectId: scene.projectId,
          sceneId: id,
        });
        tokensCharged += captures.reduce(
          (sum, capture) => sum + (capture.alreadyCaptured ? 0 : capture.creditsCaptured),
          0,
        );

        const translatedText = await zai.chat({
          systemPrompt,
          userPrompt: sourceText,
          model: translationBilling.model,
          thinking: "disabled",
          extra: { max_tokens: 4_000 },
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

      if (translateOnly === true) {
        const translatedOnly = await db.sceneTranslation.update({
          where: { id: translation.id },
          data: { status: "translated" },
        });
        return NextResponse.json({
          success: true,
          translation: translatedOnly,
          translatedOnly: true,
          tokensChargedForVoice: 0,
          tokensCharged,
        });
      }

      const providerSettings = await getAIProviderSettings();
      if (providerSettings.ttsProvider !== "qwen") {
        throw new BillingSafetyError(
          "UNPRICED_DUBBING_TTS_PROVIDER",
          `Dubbing TTS provider ${providerSettings.ttsProvider} does not have a verified Billing v2 catalog. Configure Qwen TTS before paid dubbing.`,
        );
      }
      const qwenModel = resolveQwenTtsModel(providerSettings.ttsModel);
      const chunks = splitQwenTtsInput(cleanTranslation);
      if (chunks.length === 0) throw new Error("Translation produced no billable speech chunks");

      ensureAudioDir();
      const chunkPaths: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const lineKey = `dubbing:${translation.id}:tts:${i}`;
        const ttsBilling = await reserveImmediateProviderOperation({
          userId,
          projectId: scene.projectId,
          referenceId: translation.id,
          provider: "qwen",
          model: qwenModel,
          operation: "tts",
          quantity: chunks[i].length,
          lineKey,
          label: `Dubbing voice (${langName}) chunk ${i + 1}/${chunks.length} for scene ${scene.sceneNumber}`,
          sceneId: id,
          idempotencyKey: `${lineKey}:reservation`,
        });
        const capture = await captureImmediateProviderOperation({
          reservationId: ttsBilling.reservation.id,
          lineKey,
          userId,
          projectId: scene.projectId,
          sceneId: id,
        });
        tokensCharged += capture.alreadyCaptured ? 0 : capture.creditsCaptured;

        const speech = await synthesizeQwenTts({
          input: chunks[i],
          voice,
          language: lang,
          model: qwenModel,
        });
        if (speech.model !== qwenModel) {
          throw new Error("Qwen TTS provider model changed after billing reservation");
        }
        const chunkFilename = `dub_${id}_${lang}_${i}_${Date.now()}.${speech.extension}`;
        chunkPaths.push(writeAudioFile(chunkFilename, speech.buffer));
      }

      const finalFilename = `dub_${id}_${lang}_${Date.now()}.wav`;
      const finalPath = getAudioPath(finalFilename);
      const concatenated = await concatAudioFiles(chunkPaths, finalPath);
      if (!concatenated) {
        throw new Error("Failed to assemble dubbed audio after provider synthesis");
      }
      const narrationUrl = `/api/audio/${finalFilename}`;
      for (const p of chunkPaths) deleteAudioFile(path.basename(p));

      const updated = await db.sceneTranslation.update({
        where: { id: translation.id },
        data: { narrationUrl, voiceId: voice, status: "ready" },
      });
      return NextResponse.json({
        success: true,
        translation: updated,
        chunks: chunks.length,
        provider: "qwen",
        providerModel: qwenModel,
        tokensCharged,
      });
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
