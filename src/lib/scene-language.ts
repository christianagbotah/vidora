import { db } from "@/lib/db";
import { zai } from "@/lib/zai";
import { deductTokensForOperation } from "@/lib/tokens";
import { getDubbingLanguage } from "@/lib/dubbing-languages";
import { parseDialogueSegments } from "@/lib/narration";

export interface SceneLanguageResolution {
  text: string;
  language: string;
  translated: boolean;
  translationId?: string;
}

function cleanTranslatedText(value: string): string {
  return value.replace(/^["'“”]+|["'“”]+$/g, "").trim();
}

function normalizeSpeaker(value: string | null): string {
  return (value || "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function hasMatchingSpeakerAttributions(sourceText: string, translatedText: string): boolean {
  const source = parseDialogueSegments(sourceText);
  const attributed = source.filter((segment) => Boolean(segment.speaker));
  if (attributed.length === 0) return true;

  const translated = parseDialogueSegments(translatedText);
  if (translated.length !== source.length) return false;
  return source.every((segment, index) => {
    if (!segment.speaker) return true;
    return normalizeSpeaker(translated[index]?.speaker || null) === normalizeSpeaker(segment.speaker);
  });
}

function parseTranslatedLineArray(raw: string, expected: number): string[] | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== expected) return null;
  const lines = parsed.map((value) => typeof value === "string" ? cleanTranslatedText(value) : "");
  return lines.every(Boolean) ? lines : null;
}

export function rebuildSpeakerAwareTranslation(
  sourceText: string,
  translatedLines: string[],
): string | null {
  const segments = parseDialogueSegments(sourceText);
  if (segments.length === 0 || translatedLines.length !== segments.length) return null;
  const output = segments.map((segment, index) => {
    const spoken = cleanTranslatedText(translatedLines[index] || "");
    if (!spoken) return "";
    return segment.speaker ? `${segment.speaker}: ${spoken}` : spoken;
  });
  return output.every(Boolean) ? output.join("\n") : null;
}

async function translatePreservingSpeakers(opts: {
  sourceText: string;
  languageName: string;
  sceneId: string;
  language: string;
}): Promise<string> {
  const segments = parseDialogueSegments(opts.sourceText);
  const hasAttributedSpeaker = segments.some((segment) => Boolean(segment.speaker));

  if (!hasAttributedSpeaker) {
    const translated = await zai.chat({
      systemPrompt:
        `You are a professional dubbing translator. Translate the user's narration text into ${opts.languageName}. ` +
        "Preserve the original tone, emotion, pacing, names, facts, and character intent. " +
        "Output ONLY the translated text — no explanations, no quotation marks, no notes, no preamble.",
      userPrompt: opts.sourceText,
      retry: {
        label: `translate scene ${opts.sceneId} to ${opts.language}`,
        timeoutMs: 30_000,
        maxRetries: 2,
      },
    });
    return cleanTranslatedText(translated);
  }

  const payload = segments.map((segment) => segment.text);
  const translated = await zai.chat({
    systemPrompt:
      `You are a professional dubbing translator. Translate each item in the user's JSON array into ${opts.languageName}. ` +
      "Preserve tone, emotion, pacing, names, facts, and character intent. " +
      `Return ONLY a valid JSON array of exactly ${segments.length} translated strings in the same order. ` +
      "Do not add speaker names, explanations, markdown, notes, or extra items.",
    userPrompt: JSON.stringify(payload),
    retry: {
      label: `translate speaker-aware scene ${opts.sceneId} to ${opts.language}`,
      timeoutMs: 30_000,
      maxRetries: 2,
    },
  });

  const translatedLines = parseTranslatedLineArray(translated, segments.length);
  if (!translatedLines) throw new Error("Speaker-aware translation returned an invalid line array");
  const rebuilt = rebuildSpeakerAwareTranslation(opts.sourceText, translatedLines);
  if (!rebuilt) throw new Error("Speaker-aware translation could not be rebuilt");
  return rebuilt;
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
  if (existingText && hasMatchingSpeakerAttributions(sourceText, existingText)) {
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
    const clean = await translatePreservingSpeakers({
      sourceText,
      languageName: languageMeta.name,
      sceneId,
      language: normalizedLanguage,
    });
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
