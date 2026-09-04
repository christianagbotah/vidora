import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { zai } from "@/lib/zai";
import { requireProjectAccess } from "@/lib/project-auth";
import { zaiErrorResponse } from "@/lib/zai-errors";
import { deductTokensForOperation } from "@/lib/tokens";
import { saveGeneratedFile } from "@/lib/generated-store";
import { buildCharacterPortraitPrompt, portraitImageSizeForAspect } from "@/lib/image-prompt";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  let authResult: Awaited<ReturnType<typeof requireProjectAccess>> | null = null;
  try {
    const { id, characterId } = await params;
    authResult = await requireProjectAccess(id, true);
    if (!authResult.ok) return authResult.response;

    const character = await db.character.findFirst({
      where: { id: characterId, projectId: id },
    });
    if (!character) {
      return NextResponse.json(
        { success: false, error: "Character not found in this project" },
        { status: 404 }
      );
    }

    const project = await db.videoProject.findUnique({
      where: { id },
      select: { style: true, aspectRatio: true },
    });
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

    const operationId = crypto.randomUUID();
    const deduction = await deductTokensForOperation({
      userId: authResult.session.userId,
      operation: "image_gen",
      description: `Generate project character image: ${character.name}`,
      referenceId: characterId,
      idempotencyKey: `character-image:${characterId}:${operationId}`,
    });
    if (!deduction.success) {
      return NextResponse.json(
        { success: false, error: deduction.error || "Insufficient tokens" },
        { status: 402 }
      );
    }

    const imageBase64 = await zai.generateImage({
      prompt: portraitPrompt,
      size: portraitImageSizeForAspect(project?.aspectRatio),
      retry: {
        label: `Character ${character.name} image generation`,
        timeoutMs: 120_000,
        maxRetries: 4,
      },
    });

    const imageUrl = await saveGeneratedFile(
      `characters/char_${characterId.slice(0, 8)}_${Date.now()}.png`,
      Buffer.from(imageBase64, "base64")
    );
    const updated = await db.character.update({
      where: { id: characterId },
      data: { imageUrl, imageBase64, stylePrompt: portraitPrompt },
    });

    return NextResponse.json({
      success: true,
      character: updated,
      imageUrl,
      tokensCharged: deduction.alreadyApplied ? 0 : 1,
      remainingTokens: deduction.remainingTokens,
    });
  } catch (error) {
    console.error(
      "Failed to generate character image:",
      error instanceof Error ? error.message : "unknown error"
    );
    // Do not auto-refund provider operations on ambiguous failures.
    return zaiErrorResponse(error, {
      session: authResult?.ok ? authResult.session : null,
      logLabel: "character-image",
    });
  }
}
