import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import ZAI from "z-ai-web-dev-sdk";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("429") || msg.includes("rate limit") || msg.includes("Too many requests");
}

async function withRetry<T>(fn: () => Promise<T>, label: string, maxRetries = 3): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isRetryableError(err) && attempt < maxRetries) {
        const delay = Math.min(20000, 5000 * Math.pow(2, attempt - 1));
        console.log(`${label}: rate limited, retry ${attempt}/${maxRetries} in ${delay}ms`);
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
  throw new Error(label + ": max retries exceeded");
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  try {
    const { characterId } = await params;
    const character = await db.character.findUnique({ where: { id: characterId } });
    if (!character) {
      return NextResponse.json({ success: false, error: "Character not found" }, { status: 404 });
    }

    // Build portrait prompt from character info
    const portraitPrompt = [
      character.description || `A character named ${character.name}`,
      character.role === "protagonist" ? "main character, central focus" : character.role === "narrator" ? "storyteller character" : "supporting character",
      "professional character portrait, clean background",
      "high quality, detailed, consistent art style",
      "suitable for use as character reference in video generation",
    ].join(", ");

    const zai = await ZAI.create();
    const outputDir = path.join(process.cwd(), "public", "generated", "characters");
    await mkdir(outputDir, { recursive: true });

    const imgResponse = await withRetry(
      () => zai.images.generations.create({
        prompt: portraitPrompt,
        size: "1024x1024",
      }),
      `Character ${character.name} image generation`
    );

    const imageBase64 = imgResponse.data[0].base64;
    const buffer = Buffer.from(imageBase64, "base64");
    const filename = `char_${characterId.slice(0, 8)}_${Date.now()}.png`;
    await writeFile(path.join(outputDir, filename), buffer);

    const imageUrl = `/generated/characters/${filename}`;

    // Update character with generated image and style prompt
    const updated = await db.character.update({
      where: { id: characterId },
      data: {
        imageUrl,
        imageBase64,
        stylePrompt: portraitPrompt,
      },
    });

    return NextResponse.json({
      success: true,
      character: updated,
      imageUrl,
    });
  } catch (error) {
    console.error("Failed to generate character image:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: "Failed to generate character image: " + message }, { status: 500 });
  }
}
