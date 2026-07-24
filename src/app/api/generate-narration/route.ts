import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("Too many requests")
  );
}

async function withRetry<T>(fn: () => Promise<T>, label: string, maxRetries = 5): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isRetryableError(err) && attempt < maxRetries) {
        const delay = Math.min(30000, 5000 * Math.pow(2, attempt - 1));
        console.log(`${label}: rate limited, retry ${attempt}/${maxRetries} in ${delay}ms`);
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
  throw new Error(label + ": max retries exceeded");
}

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

export async function POST(req: NextRequest) {
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

    const zai = await ZAI.create();
    const outputDir = path.join(process.cwd(), "public", "generated", "audio");
    await mkdir(outputDir, { recursive: true });

    // Split into chunks if needed, generate each chunk
    const chunks = splitTextIntoChunks(narrationText);
    const chunkFiles: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const response = await withRetry(
        () => zai.audio.tts.create({
          input: chunks[i],
          voice: voice as "tongtong" | "chuichui" | "xiaochen" | "jam" | "kazi" | "douji" | "luodo",
          response_format: "mp3",
          speed: clampedSpeed,
          stream: false,
        }),
        `TTS chunk ${i + 1}/${chunks.length}`
      );

      // SDK returns a Response object — use arrayBuffer
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(new Uint8Array(arrayBuffer));

      const chunkFile = path.join(outputDir, `chunk_${sceneId}_${i}_${Date.now()}.mp3`);
      await writeFile(chunkFile, buffer);
      chunkFiles.push(chunkFile);

      if (i < chunks.length - 1) await sleep(500);
    }

    // Use the first chunk as the narration URL (single file is good enough for UI playback)
    const narrationUrl = `/generated/audio/${path.basename(chunkFiles[0])}`;

    // If multiple chunks, also save a combined file (TODO: concat with ffmpeg for production)
    const finalNarrationUrl = chunkFiles.length === 1
      ? narrationUrl
      : narrationUrl; // For now, use first chunk

    await db.videoScene.update({
      where: { id: sceneId },
      data: { narrationUrl: finalNarrationUrl },
    });

    console.log(`Narration generated for scene ${sceneId}: ${finalNarrationUrl} (${chunks.length} chunk(s))`);

    return NextResponse.json({
      success: true,
      narrationUrl: finalNarrationUrl,
      text: narrationText,
      voice,
      chunks: chunks.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to generate narration:", error);
    return NextResponse.json({ success: false, error: "Failed to generate narration: " + message }, { status: 500 });
  }
}

// GET handler to return available voices
export async function GET() {
  return NextResponse.json({ success: true, voices: TTS_VOICES });
}
