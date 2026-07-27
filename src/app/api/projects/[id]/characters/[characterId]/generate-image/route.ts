import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { zai } from "@/lib/zai";
import { requireProjectAccess } from "@/lib/project-auth";
import { zaiErrorResponse } from "@/lib/zai-errors";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  try {
    const { id, characterId } = await params;
    const authResult = await requireProjectAccess(id, true); // write access
    if (!authResult.ok) return authResult.response;

    // Verify the character belongs to this project
    const character = await db.character.findFirst({
      where: { id: characterId, projectId: id },
    });
    if (!character) {
      return NextResponse.json({ success: false, error: "Character not found in this project" }, { status: 404 });
    }

    // Build portrait prompt from character info
    const portraitPrompt = [
      character.description || `A character named ${character.name}`,
      character.role === "protagonist" ? "main character, central focus" : character.role === "narrator" ? "storyteller character" : "supporting character",
      "professional character portrait, clean background",
      "high quality, detailed, consistent art style",
      "suitable for use as character reference in video generation",
    ].join(", ");

    const outputDir = path.join(process.cwd(), "public", "generated", "characters");
    await mkdir(outputDir, { recursive: true });

    const imageBase64 = await zai.generateImage({
      prompt: portraitPrompt,
      size: "1024x1024",
      retry: { label: `Character ${character.name} image generation`, timeoutMs: 120_000, maxRetries: 4 },
    });

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
    return zaiErrorResponse(error, {
      session: authResult.ok ? authResult.session : null,
      logLabel: "character-image",
    });
  }
}
