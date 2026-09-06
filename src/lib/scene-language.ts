import { db } from "@/lib/db";
import { zai } from "@/lib/zai";
import { deductTokensForOperation } from "@/lib/tokens";
import { getDubbingLanguage } from "@/lib/dubbing-languages";

export interface SceneLanguageResolution {
  text: string;
  language: string;
  translated: boolean;
  translationId?: string;
}

function cleanTranslatedText(value: string): string {
  return value.replace(/^["'“”]+|["'“”]+$/g, "").trim();
}

/**
 * Resolve the text that should actually be spoken for a scene language.
 * English uses the source dialogue directly. Non-English languages reuse an
 * existing SceneTranslation or create it on demand using the project's owner
 * for the normal billable LLM translation operation.
 *
 * The idempotency key intentionally matches the legacy dubbing endpoint so
 * moving between the old and new language flows never charges twice for the
 * same scene/language translation.
 */
export async function resolveSceneLanguageText(
  sceneId: string,
  language: string,
): Promise<SceneLanguageResolution> {
  const normalizedLanguage = language.trim().toLowerCase() || "en";
  const languageMeta = getDubbingLanguage(normalizedLanguage);
  if (!languageMeta) throw new Error(`Unsupported narration language: ${normalizedLanguage}`);

  const scene = await db.videoScene.findUnique({
    where: { id: sceneId },
    select: {
      id: true,
      sceneNumber: true,
      dialogue: true,
      prompt: true,
      project: { select: { userId: true } },
    },
  });
  if (!scene) throw new Error("Scene not found");

  const sourceText = scene.dialogue?.trim() || scene.prompt?.trim() || "";
  if (!sourceText) throw new Error("No narration text to translate. Add dialogue to this scene first.");

  if (normalizedLanguage === "en") {
    return { text: sourceText, language: normalizedLanguage, translated: false };
  }

  let translation = await db.sceneTranslation.findUnique({
    where: { sceneId_lang: { sceneId, lang: normalizedLanguage } },
  });

  const existingText = translation?.translatedText?.trim() || "";
  if (existingText) {
    return {
      text: existingText,
      language: normalizedLanguage,
      translated: true,
      translationId: translation?.id,
    };
  }

  const userId = scene.project.userId;
  if (!userId) throw new Error("Guest/demo projects cannot use billable translation generation");

  if (!translation) {
    translation = await db.sceneTranslation.create({
      data: {
        sceneId,
        lang: normalizedLanguage,
        langName: languageMeta.name,
        status: "translating",
      },
    });
  } else {
    translation = await db.sceneTranslation.update({
      where: { id: translation.id },
      data: { status: "translating" },
    });
  }

  const charge = await deductTokensForOperation({
    userId,
    operation: "llm",
    description: `Dubbing translation (${languageMeta.name}) for scene ${scene.sceneNumber}`,
    referenceId: translation.id,
    idempotencyKey: `dubbing:${translation.id}:translate`,
  });
  if (!charge.success) {
    await db.sceneTranslation
      .update({ where: { id: translation.id }, data: { status: "failed" } })
      .catch(() => undefined);
    throw new Error(charge.error || "Insufficient tokens for translation");
  }

  try {
    const translated = await zai.chat({
      systemPrompt:
        `You are a professional dubbing translator. Translate the user's narration text into ${languageMeta.name}. ` +
        "Preserve the original tone, emotion, pacing, speaker labels, names, facts, and character intent. " +
        "Output ONLY the translated text — no explanations, no quotation marks, no notes, no preamble.",
      userPrompt: sourceText,
      retry: {
        label: `translate scene ${sceneId} to ${normalizedLanguage}`,
        timeoutMs: 30_000,
        maxRetries: 2,
      },
    });
    const clean = cleanTranslatedText(translated);
    if (!clean) throw new Error("Translation came back empty");

    const updated = await db.sceneTranslation.update({
      where: { id: translation.id },
      data: { translatedText: clean, status: "translated" },
    });

    return {
      text: clean,
      language: normalizedLanguage,
      translated: true,
      translationId: updated.id,
    };
  } catch (error) {
    await db.sceneTranslation
      .update({ where: { id: translation.id }, data: { status: "failed" } })
      .catch(() => undefined);
    throw error;
  }
}
