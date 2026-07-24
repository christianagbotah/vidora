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

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = 5
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isRetryableError(err) && attempt < maxRetries) {
        const delay = Math.min(30000, 5000 * Math.pow(2, attempt - 1));
        console.log(
          `${label}: rate limited, retry ${attempt}/${maxRetries} in ${delay}ms`
        );
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
  throw new Error(label + ": max retries exceeded");
}

export async function POST(req: NextRequest) {
  try {
    const { projectId, sceneId, text } = await req.json();

    if (!projectId || !sceneId) {
      return NextResponse.json(
        { success: false, error: "Project ID and Scene ID are required" },
        { status: 400 }
      );
    }

    // Determine the narration text — use provided text or fall back to scene dialogue
    let narrationText = text || "";

    if (!narrationText) {
      const scene = await db.videoScene.findUnique({
        where: { id: sceneId },
      });

      if (!scene) {
        return NextResponse.json(
          { success: false, error: "Scene not found" },
          { status: 404 }
        );
      }

      if (!scene.dialogue) {
        return NextResponse.json(
          {
            success: false,
            error: "No narration text provided and scene has no dialogue",
          },
          { status: 400 }
        );
      }

      narrationText = scene.dialogue;
    }

    // Generate TTS audio with rate-limit retry
    const zai = await ZAI.create();

    const result = await withRetry(
      () =>
        zai.audio.tts.create({
          input: narrationText,
          voice: "alloy",
          response_format: "mp3",
          speed: 1.0,
        }),
      "TTS narration generation"
    );

    // Extract audio data from the result
    const audioData = result.audio || result.data || result;
    let audioBuffer: Buffer;

    if (Buffer.isBuffer(audioData)) {
      audioBuffer = audioData;
    } else if (typeof audioData === "string") {
      audioBuffer = Buffer.from(audioData, "base64");
    } else if (audioData instanceof Uint8Array) {
      audioBuffer = Buffer.from(audioData);
    } else {
      // Attempt to handle object with base64 property
      const obj = audioData as Record<string, unknown>;
      if (typeof obj.base64 === "string") {
        audioBuffer = Buffer.from(obj.base64, "base64");
      } else if (typeof obj.data === "string") {
        audioBuffer = Buffer.from(obj.data, "base64");
      } else {
        throw new Error("Unexpected audio response format from TTS API");
      }
    }

    // Ensure output directory exists
    const outputDir = path.join(
      process.cwd(),
      "public",
      "generated",
      "audio"
    );
    await mkdir(outputDir, { recursive: true });

    // Save audio file
    const timestamp = Date.now();
    const filename = `scene_${sceneId}_${timestamp}.mp3`;
    const filepath = path.join(outputDir, filename);
    await writeFile(filepath, audioBuffer);

    const narrationUrl = `/generated/audio/${filename}`;

    // Update the VideoScene record with the narration URL
    await db.videoScene.update({
      where: { id: sceneId },
      data: { narrationUrl },
    });

    console.log(
      `Narration generated for scene ${sceneId}: ${narrationUrl}`
    );

    return NextResponse.json({
      success: true,
      narrationUrl,
      text: narrationText,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to generate narration:", error);
    return NextResponse.json(
      { success: false, error: "Failed to generate narration: " + message },
      { status: 500 }
    );
  }
}
