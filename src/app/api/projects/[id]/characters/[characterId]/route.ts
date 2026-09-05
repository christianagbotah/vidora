import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/project-auth";

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function activeExportResponse(error: unknown): NextResponse | null {
  if (!errorText(error).includes("VIDORA_EXPORT_ACTIVE")) return null;
  return NextResponse.json(
    {
      success: false,
      error: "Character voice settings cannot change while an export is queued or running. Wait for the export to finish, then preview again.",
      code: "VIDORA_EXPORT_ACTIVE",
    },
    { status: 409 },
  );
}

/**
 * GET /api/projects/[id]/characters/[characterId]
 * Owner or admin (view) can access.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  try {
    const { id, characterId } = await params;
    const authResult = await requireProjectAccess(id, false);
    if (!authResult.ok) return authResult.response;

    const character = await db.character.findFirst({
      where: { id: characterId, projectId: id },
    });
    if (!character) {
      return NextResponse.json({ success: false, error: "Character not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, character });
  } catch (error) {
    console.error("Failed to fetch character:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch character" }, { status: 500 });
  }
}

/**
 * PUT /api/projects/[id]/characters/[characterId]
 * Only the project owner can edit characters.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  try {
    const { id, characterId } = await params;
    const authResult = await requireProjectAccess(id, true);
    if (!authResult.ok) return authResult.response;

    const existing = await db.character.findFirst({
      where: { id: characterId, projectId: id },
      select: { id: true, name: true, voiceId: true },
    });
    if (!existing) {
      return NextResponse.json({ success: false, error: "Character not found in this project" }, { status: 404 });
    }

    const body = await req.json();
    const { name, role, description, imageUrl, stylePrompt, imageBase64, voiceId } = body;
    const nextName = typeof name === "string" && name.trim() ? name.trim() : existing.name;
    const nextVoiceId = voiceId !== undefined
      ? (typeof voiceId === "string" && voiceId.trim() ? voiceId.trim() : null)
      : existing.voiceId;
    const voiceResolutionChanged = nextName !== existing.name || nextVoiceId !== existing.voiceId;

    const character = await db.$transaction(async (tx) => {
      const updated = await tx.character.update({
        where: { id: characterId },
        data: {
          ...(name && { name: nextName }),
          ...(role && { role }),
          ...(description !== undefined && { description }),
          ...(imageUrl !== undefined && { imageUrl }),
          ...(stylePrompt !== undefined && { stylePrompt }),
          ...(imageBase64 !== undefined && { imageBase64 }),
          ...(voiceId !== undefined && { voiceId: nextVoiceId }),
        },
      });

      if (voiceResolutionChanged) {
        await tx.videoScene.updateMany({
          where: {
            projectId: id,
            characterIds: { contains: characterId },
          },
          data: { narrationUrl: null },
        });
      }

      return updated;
    });

    return NextResponse.json({
      success: true,
      character,
      narrationInvalidated: voiceResolutionChanged,
    });
  } catch (error) {
    const guarded = activeExportResponse(error);
    if (guarded) return guarded;
    console.error("Failed to update character:", error);
    return NextResponse.json({ success: false, error: "Failed to update character" }, { status: 500 });
  }
}

/**
 * DELETE /api/projects/[id]/characters/[characterId]
 * Only the project owner can delete characters.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  try {
    const { id, characterId } = await params;
    const authResult = await requireProjectAccess(id, true);
    if (!authResult.ok) return authResult.response;

    const existing = await db.character.findFirst({
      where: { id: characterId, projectId: id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ success: false, error: "Character not found in this project" }, { status: 404 });
    }

    await db.$transaction(async (tx) => {
      // Removing a character changes speaker resolution for any scene that
      // referenced them. Clear the derived performance before deleting the
      // character so the studio never keeps playing the departed voice.
      await tx.videoScene.updateMany({
        where: {
          projectId: id,
          characterIds: { contains: characterId },
        },
        data: { narrationUrl: null },
      });
      await tx.character.delete({ where: { id: characterId } });
    });

    return NextResponse.json({ success: true, message: "Character deleted" });
  } catch (error) {
    const guarded = activeExportResponse(error);
    if (guarded) return guarded;
    console.error("Failed to delete character:", error);
    return NextResponse.json({ success: false, error: "Failed to delete character" }, { status: 500 });
  }
}
