import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { zai } from "@/lib/zai";
import { requireProjectAccess } from "@/lib/project-auth";
import { zaiErrorResponse } from "@/lib/zai-errors";
import { saveGeneratedFile } from "@/lib/generated-store";
import { buildCharacterPortraitPrompt, portraitImageSizeForAspect } from "@/lib/image-prompt";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  // Hoisted so the catch handler can reference it (it scopes the admin
  // detail in the error response) even when the try block fails early.
  let authResult: Awaited<ReturnType<typeof requireProjectAccess>> | null = null;
  try {
    const { id, characterId } = await params;
    authResult = await requireProjectAccess(id, true); // write access
    if (!authResult.ok) return authResult.response;

    // Verify the character belongs to this project
    const character = await db.character.findFirst({
      where: { id: characterId, projectId: id },
    });
    if (!character) {
      return NextResponse.json({ success: false, error: "Character not found in this project" }, { status: 404 });
    }

    // Project style steers the portrait's rendering style; the portrait is
    // generated at the PROJECT'S aspect ratio so it works as an
    // image-to-video reference without flipping the output orientation
    // (e.g. square portrait → landscape video in a 9:16 project).
    const project = await db.videoProject.findUnique({
      where: { id },
      select: { style: true, aspectRatio: true },
    });

    // Build a character-reference prompt that leads with the name + full
    // appearance description so the model renders the described character
    // as exactly as possible.
    const portraitPrompt = buildCharacterPortraitPrompt(
      {
        id: character.id,
        name: character.name,
        role: character.role,
        description: character.description,
        stylePrompt: character.stylePrompt,
      },
      project?.style
    );

    const imageBase64 = await zai.generateImage({
      prompt: portraitPrompt,
      size: portraitImageSizeForAspect(project?.aspectRatio),
      retry: { label: `Character ${character.name} image generation`, timeoutMs: 120_000, maxRetries: 4 },
    });

    const buffer = Buffer.from(imageBase64, "base64");
    const filename = `char_${characterId.slice(0, 8)}_${Date.now()}.png`;
    const imageUrl = await saveGeneratedFile(`characters/${filename}`, buffer);

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
      session: authResult?.ok ? authResult.session : null,
      logLabel: "character-image",
    });
  }
}
