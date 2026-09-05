import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSceneAccess } from "@/lib/project-auth";
import { zaiErrorResponse } from "@/lib/zai-errors";
import { deductTokensForOperation } from "@/lib/tokens";
import path from "path";
import {
  DUBBING_LANGUAGES,
  DUBBING_LANGUAGE_GROUPS,
  getDubbingLanguage,
} from "@/lib/dubbing-languages";
import { writeAudioFile, deleteAudioFile, getAudioPath, ensureAudioDir } from "@/lib/audio-storage";
import { concatWavChunks } from "@/lib/narration";
import { generateProviderText, synthesizeProviderSpeech } from "@/lib/ai-provider-router";
import {
  DEFAULT_VOICE_PROFILE,
  mergeVoiceProfiles,
  projectVoiceProfileKey,
  readVoiceProfile,
  sceneVoiceProfileKey,
} from "@/lib/voice-profile";
import { runWithVoiceSynthesisContext } from "@/lib/voice-profile-context";

export const runtime = "nodejs";

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

        const translatedText = await generateProviderText({
          systemPrompt: `You are a professional dubbing translator. Translate the user's narration text into ${langName}. Preserve names, speaker labels, meaning, tone, emotion and pacing. Output ONLY the translated text — no explanations, no quotation marks, no notes, no preamble.`,
          userPrompt: sourceText,
          thinking: "disabled",
          temperature: 0.15,
          maxTokens: 4_000,
          timeoutMs: 45_000,
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

      // Project/scene Voice Studio settings provide accent, style and speed.
      // The requested dubbing language always wins for this translated track.
      const [storedProject, storedScene] = await Promise.all([
        readVoiceProfile(projectVoiceProfileKey(scene.projectId)),
        readVoiceProfile(sceneVoiceProfileKey(scene.id)),
      ]);
      let profile = mergeVoiceProfiles(DEFAULT_VOICE_PROFILE, storedProject);
      if (scene.narrationLang?.trim()) profile = { ...profile, language: scene.narrationLang.trim().toLowerCase() };
      if (scene.narrationVoice?.trim()) profile = { ...profile, voice: scene.narrationVoice.trim() };
      profile = mergeVoiceProfiles(profile, storedScene);
      profile = {
        ...profile,
        language: lang,
        voice: typeof voiceId === "string" && voiceId.trim()
          ? voiceId.trim()
          : profile.voice,
      };

      const chunks = splitTextIntoChunks(cleanTranslation);
      ensureAudioDir();
      const chunkPaths: string[] = [];
      let resolvedVoice = profile.voice;

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

        const speech = await runWithVoiceSynthesisContext(
          { sceneProfile: profile, byVoice: {} },
          () => synthesizeProviderSpeech({
            input: chunks[i],
            voice: profile.voice === "auto" ? undefined : profile.voice,
            speed: profile.speed,
          }),
        );
        resolvedVoice = speech.voice;
        const chunkFilename = `dub_${id}_${lang}_${i}_${Date.now()}.${speech.extension}`;
        chunkPaths.push(writeAudioFile(chunkFilename, speech.buffer));
      }

      const finalFilename = `dub_${id}_${lang}_${Date.now()}.wav`;
      const finalPath = getAudioPath(finalFilename);
      const concatenated = await concatWavChunks(chunkPaths, finalPath);
      let narrationUrl: string;
      if (concatenated) {
        narrationUrl = `/api/audio/${finalFilename}`;
        for (const p of chunkPaths) deleteAudioFile(path.basename(p));
      } else {
        narrationUrl = `/api/audio/${path.basename(chunkPaths[0])}`;
      }

      const updated = await db.sceneTranslation.update({
        where: { id: translation.id },
        data: { narrationUrl, voiceId: resolvedVoice, status: "ready" },
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
