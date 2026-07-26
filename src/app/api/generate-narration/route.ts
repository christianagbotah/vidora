import { NextRequest, NextResponse } from "next/server";
import { zai, ZAIError } from "@/lib/zai";
import { db } from "@/lib/db";
import { writeFile, mkdir, unlink, readdir } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

// Split text into chunks that fit within the 1024 char TTS limit
function splitTextIntoChunks(text: string, maxLen = 900): string[] {
  if (text.length <= maxLen) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
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

// Available TTS voices with descriptions
const TTS_VOICES = [
  { id: "tongtong", label: "TongTong", desc: "Warm & friendly (narrator)" },
  { id: "chuichui", label: "ChuiChui", desc: "Playful & cute (kids)" },
  { id: "xiaochen", label: "XiaoChen", desc: "Professional & calm" },
  { id: "jam", label: "Jam", desc: "British gentleman" },
  { id: "kazi", label: "Kazi", desc: "Clear & standard" },
  { id: "douji", label: "DouJi", desc: "Natural & smooth" },
  { id: "luodo", label: "LuoDo", desc: "Expressive & engaging" },
];

/**
 * Concatenate multiple mp3 files into one using ffmpeg's concat demuxer.
 * Falls back to returning the first chunk if ffmpeg fails.
 */
async function concatMp3Files(chunkPaths: string[], outputPath: string): Promise<boolean> {
  if (chunkPaths.length === 1) {
    // Single chunk — no concat needed, just copy
    return true;
  }

  const listFile = outputPath + ".concat.txt";
  // ffmpeg concat demuxer requires paths to be escaped and use forward slashes
  const listContent = chunkPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  await writeFile(listFile, listContent, "utf-8");

  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listFile,
      "-c", "copy",
      outputPath,
    ], { timeout: 30_000 });
    // Clean up the list file
    await unlink(listFile).catch(() => {});
    return true;
  } catch (err) {
    console.error("ffmpeg concat failed, falling back to first chunk:", err);
    await unlink(listFile).catch(() => {});
    return false;
  }
}

export async function POST(req: NextRequest) {
  const tempChunkPaths: string[] = [];
  try {
    const { projectId, sceneId, text, voice = "tongtong", speed = 1.0 } = await req.json();

    if (!projectId || !sceneId) {
      return NextResponse.json({ success: false, error: "Project ID and Scene ID are required" }, { status: 400 });
    }

    // Determine the narration text
    let narrationText = text || "";

    if (!narrationText) {
      const scene = await db.videoScene.findUnique({ where: { id: sceneId } });
      if (!scene) {
        return NextResponse.json({ success: false, error: "Scene not found" }, { status: 404 });
      }
      if (!scene.dialogue) {
        return NextResponse.json({ success: false, error: "No narration text provided and scene has no dialogue" }, { status: 400 });
      }
      narrationText = scene.dialogue;
    }

    // Clamp speed
    const clampedSpeed = Math.max(0.5, Math.min(2.0, speed || 1.0));

    const outputDir = path.join(process.cwd(), "public", "generated", "audio");
    await mkdir(outputDir, { recursive: true });

    // Split into chunks if needed, generate each chunk
    const chunks = splitTextIntoChunks(narrationText);

    for (let i = 0; i < chunks.length; i++) {
      const arrayBuffer = await zai.tts({
        input: chunks[i],
        voice: voice as string,
        speed: clampedSpeed,
        retry: { label: `TTS chunk ${i + 1}/${chunks.length}`, timeoutMs: 120_000, maxRetries: 4 },
      });

      const buffer = Buffer.from(new Uint8Array(arrayBuffer));
      const chunkFile = path.join(outputDir, `chunk_${sceneId}_${i}_${Date.now()}.mp3`);
      await writeFile(chunkFile, buffer);
      tempChunkPaths.push(chunkFile);
    }

    // Generate final narration file — concatenate all chunks with ffmpeg
    const finalFilename = `narration_${sceneId}_${Date.now()}.mp3`;
    const finalPath = path.join(outputDir, finalFilename);
    const concatenated = await concatMp3Files(tempChunkPaths, finalPath);

    let narrationUrl: string;
    if (concatenated) {
      narrationUrl = `/generated/audio/${finalFilename}`;
      // Clean up the individual chunk files (keep only the final)
      for (const p of tempChunkPaths) {
        await unlink(p).catch(() => {});
      }
    } else {
      // Fallback: use the first chunk
      narrationUrl = `/generated/audio/${path.basename(tempChunkPaths[0])}`;
    }

    await db.videoScene.update({
      where: { id: sceneId },
      data: { narrationUrl, narrationVoice: voice },
    });

    console.log(`Narration generated for scene ${sceneId}: ${narrationUrl} (${chunks.length} chunk(s), concatenated=${concatenated})`);

    return NextResponse.json({
      success: true,
      narrationUrl,
      text: narrationText,
      voice,
      chunks: chunks.length,
      concatenated,
    });
  } catch (error) {
    const message = error instanceof ZAIError ? error.message : error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to generate narration:", error);
    // Clean up any orphaned chunk files on failure
    for (const p of tempChunkPaths) {
      await unlink(p).catch(() => {});
    }
    return NextResponse.json(
      { success: false, error: "Failed to generate narration: " + message },
      { status: error instanceof ZAIError && error.kind === "auth" ? 503 : 500 }
    );
  }
}

// GET handler to return available voices
export async function GET() {
  return NextResponse.json({ success: true, voices: TTS_VOICES });
}
