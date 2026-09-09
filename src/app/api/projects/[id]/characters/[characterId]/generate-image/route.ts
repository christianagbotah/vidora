import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { zai } from "@/lib/zai";
import { requireProjectAccess } from "@/lib/project-auth";
import { zaiErrorResponse } from "@/lib/zai-errors";
import { saveGeneratedFile } from "@/lib/generated-store";
import { buildCharacterPortraitPrompt, portraitImageSizeForAspect } from "@/lib/image-prompt";
import {
  captureImmediateProviderOperation,
  reserveImmediateProviderOperation,
} from "@/lib/immediate-provider-billing";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; characterId: string }> },
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
        { status: 404 },
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
      project?.style,
    );

    const operationId = crypto.randomUUID();
    const billing = await reserveImmediateProviderOperation({
      userId: authResult.session.userId,
      projectId: id,
      referenceId: characterId,
      provider: "zai",
      model: "glm-image",
      operation: "image_generation",
      quantity: 1,
      lineKey: `character-image:${characterId}:${operationId}`,
      label: `Project character image: ${character.name}`,
      sceneId: null,
      idempotencyKey: `character-image:${characterId}:${operationId}:reservation`,
    });
    const capture = await captureImmediateProviderOperation({
      reservationId: billing.reservation.id,
      lineKey: billing.line.lineKey,
      userId: authResult.session.userId,
      projectId: id,
    });

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
      Buffer.from(imageBase64, "base64"),
    );
    const updated = await db.character.update({
      where: { id: characterId },
      data: { imageUrl, imageBase64, stylePrompt: portraitPrompt },
    });

    return NextResponse.json({
      success: true,
      character: updated,
      imageUrl,
      tokensCharged: capture.alreadyCaptured ? 0 : capture.creditsCaptured,
      remainingTokens: billing.wallet.availableCredits,
    });
  } catch (error) {
    console.error(
      "Failed to generate character image:",
      error instanceof Error ? error.message : "unknown error",
    );
    return zaiErrorResponse(error, {
      session: authResult?.ok ? authResult.session : null,
      logLabel: "character-image",
    });
  }
}
