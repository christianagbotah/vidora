import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { zai } from "@/lib/zai";
import { requireSceneAccess } from "@/lib/project-auth";
import { zaiErrorResponse } from "@/lib/zai-errors";
import { execFile, execFileSync } from "child_process";
import { promisify } from "util";
import path from "path";
import {
  DUBBING_LANGUAGES,
  DUBBING_LANGUAGE_GROUPS,
  getDubbingLanguage,
} from "@/lib/dubbing-languages";
import { writeAudioFile, deleteAudioFile, getAudioPath, ensureAudioDir } from "@/lib/audio-storage";

const execFileAsync = promisify(execFile);

/**
 * POST /api/scenes/[id]/dubbing
 * Generates a dubbed narration for a scene in a target language.
 * Body: { lang: string, voiceId?: string }
 *
 * Flow:
 *   1. Translate the scene's dialogue/narration text via LLM
 *   2. Split the translation into TTS-safe chunks (~900 chars)
 *   3. Generate TTS audio for each chunk
 *   4. Concatenate chunks with ffmpeg → single MP3
 *   5. Save as a SceneTranslation record + return the audio URL
 *
 * If Z.ai is unavailable (e.g. insufficient balance), returns a graceful,
 * human-readable error so the UI can show a helpful toast.
 */

// Split text into chunks that fit within the 1024 char TTS limit.
// Mirrors the logic in /api/generate-narration so long translations
// (e.g. a 2000-char German narration) don't blow up the TTS endpoint.
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

// Concatenate wav/mp3 chunks via ffmpeg's concat demuxer.
// For single-chunk, copies the file to the output path (so the caller can
// always reference outputPath). Uses bash for file operations to bypass
// Turbopack's fs interception in dev mode.
async function concatMp3Files(chunkPaths: string[], outputPath: string): Promise<boolean> {
  if (chunkPaths.length === 1) {
    // Single chunk: copy to output path via bash (bypasses Turbopack)
    try {
      execFileSync("bash", ["-c", `cp "${chunkPaths[0]}" "${outputPath}"`]);
      return true;
    } catch (err) {
      console.error("[dubbing] single-chunk copy failed:", err);
      return false;
    }
  }
  // Multi-chunk: use ffmpeg concat demuxer
  const listFile = outputPath + ".concat.txt";
  const listContent = chunkPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  // Write the list file via bash (bypasses Turbopack)
  execFileSync("bash", ["-c", `cat > "${listFile}"`], { input: listContent });
  try {
    await execFileAsync("ffmpeg", [
      "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outputPath,
    ], { timeout: 30_000 });
    execFileSync("bash", ["-c", `rm -f "${listFile}"`]);
    return true;
  } catch (err) {
    console.error("[dubbing] ffmpeg concat failed:", err);
    execFileSync("bash", ["-c", `rm -f "${listFile}"`]);
    return false;
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

    const { lang, voiceId } = await req.json();
    const langMeta = lang ? getDubbingLanguage(lang) : null;
    if (!langMeta) {
      return NextResponse.json(
        { success: false, error: `Unsupported language. Supported codes: ${Object.keys(DUBBING_LANGUAGES).join(", ")}` },
        { status: 400 }
      );
    }

    const scene = await db.videoScene.findUnique({ where: { id } });
    if (!scene) {
      return NextResponse.json({ success: false, error: "Scene not found" }, { status: 404 });
    }

    const sourceText = scene.dialogue || scene.prompt;
    if (!sourceText) {
      return NextResponse.json(
        { success: false, error: "No narration text to translate. Add dialogue to this scene first." },
        { status: 400 }
      );
    }

    const langName = langMeta.name;
    // Canonical lowercase voice id — "tongtong" is the SDK default.
    const voice = (voiceId || "tongtong").toLowerCase();

    // Create or update the translation record
    let translation = await db.sceneTranslation.findUnique({
      where: { sceneId_lang: { sceneId: id, lang } },
    });

    if (translation && translation.status === "ready" && translation.translatedText && translation.narrationUrl) {
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
      // ── Step 1: Translate via LLM ────────────────────────────────────────
      // NOTE: zai.chat() expects { systemPrompt, userPrompt } — NOT { messages }.
      // Passing { messages } silently drops the content → Z.ai rejects with
      // "API parameters incorrect". This was the root cause of dubbing failing.
      const translatedText = await zai.chat({
        systemPrompt: `You are a professional dubbing translator. Translate the user's narration text into ${langName}. Preserve the original tone, emotion, pacing, and any character voice. Output ONLY the translated text — no explanations, no quotation marks, no notes, no preamble.`,
        userPrompt: sourceText,
        retry: { label: `translate to ${lang}`, timeoutMs: 30_000, maxRetries: 2 },
      });

      const cleanTranslation = translatedText.replace(/^["'“”]+|["'“”]+$/g, "").trim();
      if (!cleanTranslation) {
        throw new Error("Translation came back empty");
      }

      await db.sceneTranslation.update({
        where: { id: translation.id },
        data: { translatedText: cleanTranslation, status: "generating" },
      });

      // ── Step 2: Split into TTS-safe chunks ───────────────────────────────
      const chunks = splitTextIntoChunks(cleanTranslation);
      // Write to /tmp/vidora-audio/ via the audio-storage helper, which uses
      // bash to bypass Turbopack's fs interception in dev mode.
      ensureAudioDir();

      const chunkPaths: string[] = [];

      // ── Step 3: Generate TTS audio per chunk ──────────────────────────────
      for (let i = 0; i < chunks.length; i++) {
        const arrayBuffer = await zai.tts({
          input: chunks[i], // ✅ CORRECT: TTSOptions expects `input`, not `text`
          voice,
          retry: { label: `tts ${lang} chunk ${i + 1}/${chunks.length}`, timeoutMs: 120_000, maxRetries: 4 },
        });
        // ✅ CORRECT conversion: ArrayBuffer → Node Buffer via Uint8Array.
        const buffer = Buffer.from(new Uint8Array(arrayBuffer));
        // Z.ai returns WAV audio (API rejects "mp3" response_format), so we
        // save chunks as .wav. Use the bash-based writer to bypass Turbopack.
        const chunkFilename = `dub_${id}_${lang}_${i}_${Date.now()}.wav`;
        const chunkFile = writeAudioFile(chunkFilename, buffer);
        chunkPaths.push(chunkFile);
      }

      // ── Step 4: Concatenate chunks (if >1) ───────────────────────────────
      const finalFilename = `dub_${id}_${lang}_${Date.now()}.wav`;
      const finalPath = getAudioPath(finalFilename);
      const concatenated = await concatMp3Files(chunkPaths, finalPath);

      let narrationUrl: string;
      if (concatenated) {
        // Serve via the /api/audio API route (works in dev + production)
        narrationUrl = `/api/audio/${finalFilename}`;
        // Clean up individual chunks, keep only the final
        for (const p of chunkPaths) {
          deleteAudioFile(path.basename(p));
        }
      } else {
        // Fallback: serve the first chunk directly
        narrationUrl = `/api/audio/${path.basename(chunkPaths[0])}`;
      }

      const updated = await db.sceneTranslation.update({
        where: { id: translation.id },
        data: { narrationUrl, voiceId: voice, status: "ready" },
      });

      return NextResponse.json({
        success: true,
        translation: updated,
        chunks: chunks.length,
      });
    } catch (aiError) {
      // Mark the translation as failed in DB, then surface a differentiated error:
      // admins see raw diagnostic, regular users see friendly "service unavailable".
      await db.sceneTranslation.update({
        where: { id: translation.id },
        data: { status: "failed" },
      }).catch(() => {});
      return zaiErrorResponse(aiError, {
        session: authResult.ok ? authResult.session : null,
        logLabel: "dubbing",
      });
    }
  } catch (error) {
    console.error("[dubbing POST]", error);
    return NextResponse.json({ success: false, error: "Failed to generate dubbing" }, { status: 500 });
  }
}

/**
 * GET /api/scenes/[id]/dubbing
 * Returns all translations for a scene + the full supported language catalog.
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
    return NextResponse.json({
      success: true,
      translations,
      supportedLangs: DUBBING_LANGUAGES,
      languageGroups: DUBBING_LANGUAGE_GROUPS,
    });
  } catch (error) {
    console.error("[dubbing GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load translations" }, { status: 500 });
  }
}

/**
 * DELETE /api/scenes/[id]/dubbing?lang=en
 * Removes a single translation (audio + text) for the given language.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await requireSceneAccess(id, true);
    if (!authResult.ok) return authResult.response;

    const { searchParams } = new URL(req.url);
    const lang = searchParams.get("lang");
    if (!lang || !getDubbingLanguage(lang)) {
      return NextResponse.json(
        { success: false, error: "A valid `lang` query parameter is required" },
        { status: 400 }
      );
    }

    const translation = await db.sceneTranslation.findUnique({
      where: { sceneId_lang: { sceneId: id, lang } },
    });
    if (!translation) {
      return NextResponse.json({ success: false, error: "Translation not found" }, { status: 404 });
    }

    // Best-effort: delete the audio file from disk (non-fatal if missing)
    if (translation.narrationUrl) {
      const filename = translation.narrationUrl.split("/").pop();
      if (filename) {
        try { deleteAudioFile(filename); } catch { /* non-fatal */ }
      }
    }

    await db.sceneTranslation.delete({ where: { id: translation.id } });
    return NextResponse.json({ success: true, message: "Translation deleted" });
  } catch (error) {
    console.error("[dubbing DELETE]", error);
    return NextResponse.json({ success: false, error: "Failed to delete translation" }, { status: 500 });
  }
}
